/**
 * `DocsSource` — the worktree-aware doc index for the Docs surface (spec §5.4).
 * Emits a `DocSignal` (a DISTINCT kind — never an `ArtifactSignal`, so worktree
 * docs can't leak into the Board/routine-health artifact folds) for every
 * spec/plan/handoff/backlog across the MAIN checkout AND every git worktree.
 *
 * Worktrees are read through `ctx.worktrees` PSEUDO-KEYS (PF-8): each is a
 * contained read key into `ctx.fs`, so a worktree that lives OUTSIDE the repo
 * root is still indexed and the absolute path never leaks to this source. The
 * MAIN scan passes a walk-time `exclude` so the recursive handoffs glob never
 * descends into `.claude/worktrees/` (scanned separately) or the `docs/review/`
 * interim mirror — a prune at traversal, not a post-filter.
 *
 * Metadata-only at index time: only the frontmatter HEAD (`readTextHead`) is
 * read, never the body (the body is fetched on demand by `doc-content`). Capped
 * at `MAX_DOCS_PER_REPO` with a `truncated` diagnostic — never a silent drop.
 * Signals carry `repo` (the parent repoKey) only — `projectKey` resolves at
 * projection time (PF-5). Does NOT edit `artifactSource`/`specBacklogSource`.
 */

import {
  signalError,
  type CollectionContext,
  type WorktreeCheckout,
} from "../contracts/collection-context.js";
import type { SignalBatch, WorkSignalSource } from "../contracts/WorkSignalSource.js";
import type { DocSignal, Signal, SignalError } from "../contracts/signals.js";
import { DOC_FRONTMATTER_SCAN_BYTES, MAX_DOCS_PER_REPO, makeDocId } from "../contracts/doc-index.js";
import { collectPerRepo, readError, type RepoReadResult } from "./_shared.js";
import { parseFrontmatterHead } from "./frontmatter-head.js";
import { classifyDocPath } from "./parse.js";

export const DOCS_SOURCE_ID = "docs";

/** The doc globs scanned per checkout (specs in both locations, plans, handoffs, backlog). */
const DOC_GLOBS = [
  "specs/**/*.md",
  "docs/superpowers/specs/**/*.md",
  "docs/superpowers/plans/**/*.md",
  "**/handoffs/**/*.md",
  "backlog/**/*.md",
] as const;

/**
 * Walk-time prune for the MAIN checkout scan: worktrees are scanned separately
 * (so the main walk must never descend into `.claude/worktrees/` and mis-tag a
 * worktree doc as `checkoutId:"main"`), and the `docs/review/` interim mirror is
 * excluded so it never renders beside its canonical worktree doc (§5.4/§13.4).
 */
const MAIN_EXCLUDE = [".claude/worktrees", "docs/review", ".git", "node_modules", "dist", "build"] as const;

export const docsSource: WorkSignalSource = {
  id: DOCS_SOURCE_ID,
  collect(ctx: CollectionContext): Promise<SignalBatch> {
    const worktreesByRepo = new Map<string, WorktreeCheckout[]>();
    for (const wt of ctx.worktrees) {
      const list = worktreesByRepo.get(wt.parentRepoKey) ?? [];
      list.push(wt);
      worktreesByRepo.set(wt.parentRepoKey, list);
    }

    return collectPerRepo(DOCS_SOURCE_ID, ctx, async (repo, c): Promise<RepoReadResult> => {
      const signals: Signal[] = [];
      const errors: SignalError[] = [];
      // MAX_DOCS_PER_REPO is a PER-REPO cap shared across the main checkout AND
      // every worktree (codex A P1) — a repo with N worktrees can't emit N×cap.
      const budget = { remaining: MAX_DOCS_PER_REPO };
      // Main checkout — keyed by the repoKey, walk-time-pruned of worktrees + the review mirror.
      signals.push(...(await scanCheckout(c, repo.repo, repo.repo, "main", null, null, MAIN_EXCLUDE, errors, budget)));
      // Each worktree — its own root is the base, so no exclude is needed.
      for (const wt of worktreesByRepo.get(repo.repo) ?? []) {
        signals.push(...(await scanCheckout(c, repo.repo, wt.key, wt.checkoutId, wt.name, wt.branch, undefined, errors, budget)));
      }
      return { signals, errors };
    });
  },
};

/** Scan one checkout (main repoKey or a worktree pseudo-key) for docs, head-only. */
async function scanCheckout(
  ctx: CollectionContext,
  repoKey: string,
  checkoutKey: string,
  checkoutId: string,
  worktreeName: string | null,
  branch: string | null,
  exclude: readonly string[] | undefined,
  errors: SignalError[],
  budget: { remaining: number },
): Promise<DocSignal[]> {
  const files = await ctx.fs.list(checkoutKey, DOC_GLOBS, exclude ? { exclude } : undefined);
  const docs: DocSignal[] = [];
  let truncated = false;

  for (const file of files) {
    if (budget.remaining <= 0) {
      truncated = true;
      break;
    }
    let head: string;
    try {
      head = await ctx.fs.readTextHead(checkoutKey, file.relPath, DOC_FRONTMATTER_SCAN_BYTES);
    } catch (err) {
      errors.push(readError(file.relPath, err)); // degraded read — recorded, never thrown
      continue;
    }
    const fm = parseFrontmatterHead(head);
    const docId = makeDocId(repoKey, checkoutId, file.relPath);
    const indexFingerprint = ctx.hash(`${file.mtime} ${file.sizeBytes} ${head}`);
    docs.push({
      kind: "doc",
      source: DOCS_SOURCE_ID,
      repo: repoKey,
      path: file.relPath,
      confidence: "high",
      freshness: "live",
      errors: [],
      docType: classifyDocPath(file.relPath),
      docId,
      checkoutId,
      checkoutKey,
      worktreeName,
      relPath: file.relPath,
      branch,
      title: fm.title,
      status: fm.status,
      mtime: file.mtime,
      sizeBytes: file.sizeBytes,
      indexFingerprint,
    });
    budget.remaining--;
  }

  if (truncated) {
    // Non-degraded (a cap, not a failed read) — surfaced so truncation is never silent.
    errors.push(
      signalError("truncated", `doc index truncated at ${MAX_DOCS_PER_REPO} for ${repoKey} (${checkoutId})`, false),
    );
  }
  return docs;
}
