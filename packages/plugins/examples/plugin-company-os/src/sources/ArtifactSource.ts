/**
 * `ArtifactSource` — the docs/reports viewer index. Scans the workspace for
 * specs, handoffs, cannons/review reports, and routine outputs, emitting one
 * `ArtifactSignal` per file (type + system + prefix + status + title + sha256 +
 * size + mtime). The ArtifactIndex projection (COS-0f) folds these into the
 * Reports tab. COS-1 teaching + COS-2 knowledge add their OWN sources behind the
 * extension seam — this source never needs to know about them.
 *
 * Type is resolved from the frontmatter `type` first (authoritative), then a
 * path heuristic; an unclassifiable doc is skipped, not mis-indexed.
 */

import { type CollectionContext, type RepoRoot } from "../contracts/collection-context.js";
import type { WorkSignalSource, SignalBatch } from "../contracts/WorkSignalSource.js";
import type { ArtifactSignal, Signal, SignalError } from "../contracts/signals.js";
import type { ArtifactType } from "../contracts/vocab.js";
import { parseFrontmatter, prefixOf, ticketFromFilename } from "./parse.js";
import { collectPerRepo, readError, type RepoReadResult } from "./_shared.js";

export const ARTIFACT_SOURCE_ID = "artifact";

/**
 * Union of artifact globs scanned per repo (repo-relative; non-matches return
 * nothing). `reports/**` is indexed WHOLE rather than dir-by-dir so the index
 * catches every routine-output directory an AGENTS `company_os` block can declare
 * (strategy / health / process / journal / harvest / standup / weekly / …) — the
 * routine-health join (COS-0f) depends on those artifacts being present, and a
 * hardcoded dir list silently drops the routines whose dir isn't enumerated.
 * `typeFromPath` classifies each `reports/**` file (cannons / handoff / routine
 * output) so the broad glob doesn't mis-bucket.
 */
const ARTIFACT_GLOBS = [
  "specs/**/*.md",
  "docs/superpowers/specs/**/*.md",
  "reports/**/*.md",
] as const;

/** Frontmatter `type` value → artifact type (authoritative when present). */
const TYPE_BY_FRONTMATTER: Record<string, ArtifactType> = {
  spec: "spec",
  handoff: "handoff",
  "cannons-report": "cannons",
  cannons: "cannons",
  "review-report": "cannons",
  "routine-output": "routine_output",
  routine_output: "routine_output",
};

/**
 * Path heuristic when frontmatter carries no `type`. Order matters: the specific
 * report families (cannons, handoffs) win first; every OTHER file under
 * `reports/**` is a routine output. That catch-all is deliberate — it means a NEW
 * routine-output directory (declared in an AGENTS `company_os` block) is indexed
 * the moment it exists, without editing this list, so the routine-health join
 * never silently drops a routine whose dir we forgot to enumerate.
 */
function typeFromPath(relPath: string): ArtifactType | null {
  if (/(^|\/)reports\/review-cannons\//.test(relPath) || /(^|\/)reports\/reviews\//.test(relPath)) return "cannons";
  if (/(^|\/)reports\/handoffs\//.test(relPath)) return "handoff";
  if (/(^|\/)(specs|docs\/superpowers\/specs)\//.test(relPath)) return "spec";
  if (/(^|\/)reports\//.test(relPath)) return "routine_output"; // any other reports/** file
  return null;
}

export const artifactSource: WorkSignalSource = {
  id: ARTIFACT_SOURCE_ID,
  collect(ctx: CollectionContext): Promise<SignalBatch> {
    return collectPerRepo(ARTIFACT_SOURCE_ID, ctx, async (repo, c): Promise<RepoReadResult> => {
      const files = await c.fs.list(repo.repo, [...ARTIFACT_GLOBS]);
      const signals: Signal[] = [];
      const errors: SignalError[] = [];
      const seen = new Set<string>();
      for (const file of files) {
        if (seen.has(file.relPath)) continue; // dedupe overlapping globs
        seen.add(file.relPath);
        let text: string;
        try {
          text = await c.fs.readText(repo.repo, file.relPath);
        } catch (err) {
          errors.push(readError(file.relPath, err));
          continue;
        }
        const sig = artifactSignal(repo, file.relPath, file.mtime, file.sizeBytes, text, c);
        if (sig) signals.push(sig);
      }
      return { signals, errors };
    });
  },
};

function artifactSignal(
  repo: RepoRoot,
  relPath: string,
  mtime: string,
  sizeBytes: number,
  text: string,
  ctx: CollectionContext,
): ArtifactSignal | null {
  const fm = parseFrontmatter(text);
  const artifactType =
    (fm?.type ? TYPE_BY_FRONTMATTER[fm.type.trim().toLowerCase()] : undefined) ?? typeFromPath(relPath);
  if (!artifactType) return null; // unclassifiable doc — don't pollute the index

  const ticketId = fm?.id ?? fm?.ticket ?? ticketFromFilename(relPath);
  const prefix = fm?.prefix ?? (ticketId ? prefixOf(ticketId) : null);
  return {
    kind: "artifact",
    source: ARTIFACT_SOURCE_ID,
    repo: repo.repo,
    path: relPath,
    mtime,
    confidence: "high",
    freshness: "live",
    errors: [],
    artifactType,
    relPath,
    system: fm?.system ?? null,
    prefix: prefix ?? null,
    status: fm?.status ?? null,
    sha256: ctx.hash(text),
    sizeBytes,
    title: fm?.title ?? null,
    createdBy: fm?.created_by ?? null,
  };
}
