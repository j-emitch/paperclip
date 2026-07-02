/**
 * `TeachingSource` — the COS-2f fill of the empty COS-0b `TeachingSignalSource`
 * seam. It turns the teaching CORPUS on disk into `ArtifactSignal`s
 * (`artifactType: "teaching"`), each carrying `TeachingArtifactMeta`, so the
 * Teaching tab's live `deriveTeachingOverview` fold has a typed, host-free input.
 *
 * It reads three things per repo, via the containment-checked `ctx.fs` ONLY (no
 * `node:fs`, no `child_process`) and NEVER throws (the `WorkSignalSource`
 * contract — a bad read degrades the repo's freshness instead of blanking it):
 *
 *   1. `docs/teachings/inbox/*.md`       → the un-synthesized backlog. Each
 *      promote-log's nugget bullets (`- **…**`) are counted so the tab can show
 *      "N nuggets across M logs" + the oldest log's age.
 *   2. the unit corpus, both the post-COS-2b split (`internal/units/**`,
 *      `external/units/**`) AND the pre-migration `units/**` — so the tab works
 *      BEFORE the Joe-gated corpus migration lands, degrading a pre-migration
 *      unit's lens to `unspecified` (never guessing internal/external).
 *   3. the `librarian.teachings-synthesis.json` A1 synthesis receipts under
 *      `reports/routine-runs` (globbed recursively). Only their mtime matters
 *      (freshness), so they are NOT read — a missing dir means "never synthesized".
 *
 * This source is DELIBERATELY NOT in `DEFAULT_SOURCES`: the Teaching tab is a
 * live, file-backed read (no cached `cos_teaching_*` table — deferred to COS-3),
 * so wiring it into the cached derive would add teaching artifacts to the shared
 * board/artifact-index pipeline and break COS-2f's "byte-identical when the tab
 * is off" contract. The worker's `teaching-overview` handler runs it directly.
 */

import type { CollectionContext } from "../contracts/collection-context.js";
import type { SignalBatch, WorkSignalSource } from "../contracts/WorkSignalSource.js";
import type { TeachingSignalSource } from "../contracts/extensions.js";
import type {
  ArtifactSignal,
  Signal,
  SignalError,
  TeachingArtifactMeta,
} from "../contracts/signals.js";
import {
  TEACHING_AUDIENCES,
  TEACHING_PUBLISH_STATES,
  type TeachingAudience,
  type TeachingLens,
  type TeachingPublishState,
} from "../contracts/vocab.js";
import { parseFrontmatter } from "./parse.js";
import { collectPerRepo, readError, type RepoReadResult } from "./_shared.js";

export const TEACHING_SOURCE_ID = "teaching";

/** The teachings root, relative to a repo (only `company` has it in practice). */
const TEACH_ROOT = "docs/teachings";

/** Workspace globs the source lists per repo (one `fs.list`, then classified by path). */
const TEACHING_GLOBS = [
  `${TEACH_ROOT}/inbox/*.md`,
  `${TEACH_ROOT}/units/**/*.md`, // pre-COS-2b-migration lens: unspecified
  `${TEACH_ROOT}/internal/units/**/*.md`, // post-migration internal lens
  `${TEACH_ROOT}/external/units/**/*.md`, // post-migration external lens
  "reports/routine-runs/**/librarian.teachings-synthesis.json",
] as const;

/**
 * Nugget bullet in a promote-log: a TOP-LEVEL `- **title**` list item (no leading
 * indent). Anchoring at column 0 excludes nested bullets (e.g. a nugget's
 * `  - _src:_ …` line or a `  - **sub-point**`), and the fence tracking in
 * `inboxMeta` skips ``` code blocks — so the backlog count (which drives the
 * critical headline) can't be inflated by prose (codex-B P1).
 */
const NUGGET_RE = /^-\s+\*\*/;
const FENCE_RE = /^\s*```/;

export const teachingSource: TeachingSignalSource = {
  id: TEACHING_SOURCE_ID,
  extensionKind: "teaching",
  collect(ctx: CollectionContext): Promise<SignalBatch> {
    return collectPerRepo(TEACHING_SOURCE_ID, ctx, async (repo, c): Promise<RepoReadResult> => {
      const files = await c.fs.list(repo.repo, [...TEACHING_GLOBS]);
      const signals: Signal[] = [];
      const errors: SignalError[] = [];

      for (const file of files) {
        const rel = file.relPath;
        const base = rel.split("/").pop() ?? rel;
        const kind = classify(rel, base);
        if (kind === null) continue; // README / anything off-shape → skip

        if (kind === "synthesis") {
          // Freshness is all that matters — presence + mtime, never the bytes.
          signals.push(baseSignal(repo.repo, file, c.hash(`${rel}:${file.mtime}`), null, syntheticMeta(rel)));
          continue;
        }

        // inbox + unit need the text (nugget count / frontmatter).
        let text: string;
        try {
          text = await c.fs.readText(repo.repo, rel);
        } catch (err) {
          errors.push(readError(rel, err));
          continue;
        }
        const sha = c.hash(text);
        if (kind === "inbox") {
          signals.push(baseSignal(repo.repo, file, sha, null, inboxMeta(text)));
        } else {
          const { title, meta } = unitMetaFrom(rel, text);
          signals.push(baseSignal(repo.repo, file, sha, title, meta));
        }
      }

      return { signals, errors };
    });
  },
};

/** Assignable to the base seam too (COS-0b: a teaching source IS a WorkSignalSource). */
export const teachingWorkSource: WorkSignalSource = teachingSource;

// ---------------------------------------------------------------------------
// classification + meta builders (pure)
// ---------------------------------------------------------------------------

type Kind = TeachingArtifactMeta["entryKind"] | null;

function classify(rel: string, base: string): Kind {
  if (base === "librarian.teachings-synthesis.json") return "synthesis";
  // Skip READMEs BEFORE the inbox branch — an `inbox/README.md` is not a backlog
  // log (it would inflate pendingLogs by one with zero nuggets) [codex-A P1].
  if (base === "README.md") return null;
  if (rel.startsWith(`${TEACH_ROOT}/inbox/`)) return "inbox";
  if (/(?:^|\/)units\/.+\.md$/.test(rel)) return "unit";
  return null;
}

/** Lens from the PATH (honest about on-disk layout, never inferred from frontmatter). */
function lensOf(rel: string): TeachingLens {
  if (rel.includes(`${TEACH_ROOT}/internal/units/`)) return "internal";
  if (rel.includes(`${TEACH_ROOT}/external/units/`)) return "external";
  return "unspecified"; // pre-migration `docs/teachings/units/**`
}

/**
 * The first directory segment under `units/` (e.g. `03-migrations-and-staging`);
 * null for a file loose directly under `units/`. Captures the top unit dir at ANY
 * nesting depth — the glob accepts `units/**`, so a deeper `units/03-x/sub/a.md`
 * must still group under `03-x` rather than falling to Ungrouped (codex-A/B).
 */
function unitDirOf(rel: string): string | null {
  const m = /(?:^|\/)units\/([^/]+)\//.exec(rel);
  return m ? m[1] : null;
}

function inboxMeta(text: string): TeachingArtifactMeta {
  let pending = 0;
  let inFence = false;
  for (const line of text.split(/\r?\n/)) {
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence && NUGGET_RE.test(line)) pending++;
  }
  return { entryKind: "inbox", lens: null, audience: null, publishState: null, unit: null, pendingNuggets: pending, lastVerified: null };
}

function syntheticMeta(_rel: string): TeachingArtifactMeta {
  return { entryKind: "synthesis", lens: null, audience: null, publishState: null, unit: null, pendingNuggets: null, lastVerified: null };
}

function unitMetaFrom(rel: string, text: string): { title: string | null; meta: TeachingArtifactMeta } {
  const fm = parseFrontmatter(text) ?? {};
  const base = rel.split("/").pop() ?? rel;
  // A blank/whitespace `title:` must fall back to the basename — an empty string
  // would fail the `title: z.string().min(1)` contract and brick the tab (codex-A/B P1).
  const title = fm.title?.trim() || base.replace(/\.md$/, "");
  const meta: TeachingArtifactMeta = {
    entryKind: "unit",
    lens: lensOf(rel),
    audience: normAudience(fm.audience),
    publishState: normPublishState(fm.publish_state),
    unit: fm.unit ?? unitDirOf(rel),
    pendingNuggets: null,
    lastVerified: fm.last_verified ?? null,
  };
  return { title, meta };
}

/** Frontmatter `audience` → the closed set (default `internal`, matching COS-2b). */
function normAudience(raw: string | undefined): TeachingAudience {
  return (TEACHING_AUDIENCES as readonly string[]).includes(raw ?? "") ? (raw as TeachingAudience) : "internal";
}

/** Frontmatter `publish_state` → the closed set (default `private`, matching COS-2b). */
function normPublishState(raw: string | undefined): TeachingPublishState {
  return (TEACHING_PUBLISH_STATES as readonly string[]).includes(raw ?? "") ? (raw as TeachingPublishState) : "private";
}

// ---------------------------------------------------------------------------
// signal builder
// ---------------------------------------------------------------------------

function baseSignal(
  repo: string,
  file: { relPath: string; mtime: string; sizeBytes: number },
  sha256: string,
  title: string | null,
  teaching: TeachingArtifactMeta,
): ArtifactSignal {
  return {
    kind: "artifact",
    source: TEACHING_SOURCE_ID,
    repo,
    path: file.relPath,
    mtime: file.mtime,
    confidence: "high",
    freshness: "live",
    errors: [],
    artifactType: "teaching",
    relPath: file.relPath,
    system: "Company",
    prefix: null,
    status: null,
    sha256,
    sizeBytes: file.sizeBytes,
    title,
    teaching,
  };
}
