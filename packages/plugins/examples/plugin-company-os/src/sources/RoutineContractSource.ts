/**
 * `RoutineContractSource` — emits a `RoutineSignal` per report-routine declared
 * in an AGENTS.md `company_os:` fenced block (the CEO/COO/CTO/Librarian
 * directives). It reads the contract only (id, display_name, cadence,
 * expected_artifact, owner_agent); the last-run join + SLO verdict happen in the
 * RoutineHealth projection (COS-0f) against `issues.read` + artifact mtime.
 *
 * The block marker is a real `company_os:` YAML ROOT KEY (not a comment), so a
 * parser actually sees it. The parser tolerates an optional sibling
 * `write_authority:` key (PWA-01/COS-3 forward-compat) — present-or-absent, it
 * never changes routine parsing.
 */

import { type CollectionContext, type RepoRoot } from "../contracts/collection-context.js";
import type { WorkSignalSource, SignalBatch } from "../contracts/WorkSignalSource.js";
import type { RoutineSignal, Signal, SignalError } from "../contracts/signals.js";
import { extractCompanyOsYaml, parseCompanyOsBlock } from "./parse.js";
import { collectPerRepo, readError, type RepoReadResult } from "./_shared.js";

export const ROUTINE_CONTRACT_SOURCE_ID = "routine-contract";

/** Where the directive AGENTS.md files live (only the company repo matches in practice). */
const AGENTS_GLOB = "config/paperclip/agents/**/AGENTS.md";

/**
 * Normalize a routine's `expected_artifact` glob so a flat single-segment match
 * also matches date-bucketed outputs (`<dir>/2026/06-23.md`). The AGENTS blocks
 * declare a single-star tail (one path segment only), but a routine may bucket
 * its output into sub-dirs; rewriting that tail to a recursive cross-segment
 * match makes the artifact join robust to either layout. A glob that is already
 * recursive (double-star anchored) is left untouched (no doubling).
 */
export function normalizeArtifactGlob(glob: string): string {
  return glob.replace(/([^*/])\/\*(\.[A-Za-z0-9]+)?$/, "$1/**/*$2");
}

export const routineContractSource: WorkSignalSource = {
  id: ROUTINE_CONTRACT_SOURCE_ID,
  collect(ctx: CollectionContext): Promise<SignalBatch> {
    return collectPerRepo(ROUTINE_CONTRACT_SOURCE_ID, ctx, async (repo, c): Promise<RepoReadResult> => {
      const files = await c.fs.list(repo.repo, [AGENTS_GLOB]);
      const signals: Signal[] = [];
      const errors: SignalError[] = [];
      for (const file of files) {
        let text: string;
        try {
          text = await c.fs.readText(repo.repo, file.relPath);
        } catch (err) {
          errors.push(readError(file.relPath, err));
          continue;
        }
        const yaml = extractCompanyOsYaml(text);
        if (!yaml) continue; // an AGENTS file without a company_os block is normal, not an error
        const block = parseCompanyOsBlock(yaml);
        for (const e of block.errors) {
          errors.push({ code: "parse_error", message: `${file.relPath}: ${e}`, degraded: false });
        }
        for (const r of block.routines) {
          signals.push(
            routineSignal(repo, file.relPath, r.id, r.display_name, r.owner_agent, r.cadence, normalizeArtifactGlob(r.expected_artifact)),
          );
        }
      }
      return { signals, errors };
    });
  },
};

function routineSignal(
  repo: RepoRoot,
  relPath: string,
  routineKey: string,
  displayName: string,
  ownerAgent: string,
  cadence: string,
  expectedArtifactGlob: string,
): RoutineSignal {
  return {
    kind: "routine",
    source: ROUTINE_CONTRACT_SOURCE_ID,
    repo: repo.repo,
    path: relPath,
    confidence: "high",
    freshness: "live",
    errors: [],
    routineKey,
    displayName,
    ownerAgent,
    cadence,
    expectedArtifactGlob,
  };
}
