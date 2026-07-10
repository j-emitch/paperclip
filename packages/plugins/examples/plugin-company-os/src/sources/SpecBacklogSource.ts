/**
 * `SpecBacklogSource` — the Next-up column from spec/backlog frontmatter, plus a
 * CONTEXT.md "What's In Progress" backstop. A spec/backlog doc whose frontmatter
 * status is not-yet-started → a `next_up` candidate; an in-progress status → a
 * low-confidence `in_progress` candidate (rung 4: spec_frontmatter) that the
 * projection lets git override. CONTEXT "What's In Progress" tickets surface
 * known in-progress work that may not have a worktree yet — also low confidence.
 *
 * Done/shipped statuses emit nothing — `GitWorkSource` owns the Shipped column.
 */

import { type CollectionContext, type RepoRoot } from "../contracts/collection-context.js";
import type { WorkSignalSource, SignalBatch } from "../contracts/WorkSignalSource.js";
import type { Signal, SignalError, WorkSignal } from "../contracts/signals.js";
import type { WorkState } from "../contracts/vocab.js";
import {
  extractContextInProgress,
  parseFrontmatter,
  prefixOf,
  ticketFromFilename,
} from "./parse.js";
import { collectPerRepo, readError, type RepoReadResult } from "./_shared.js";

export const SPEC_BACKLOG_SOURCE_ID = "spec-backlog";

const SPEC_GLOBS = [
  "specs/**/*.md",
  "docs/superpowers/specs/**/*.md",
  "backlog/**/*.md",
  "docs/superpowers/plans/**/*.md",
] as const;
const CONTEXT_GLOBS = ["CONTEXT.md"] as const;

/**
 * Frontmatter status → board state. Unlisted/`done`-family → no work signal.
 *
 * C5 (B9): the 2026-07-02 backlog standard's states are FIRST-CLASS here —
 * `triaged` → next_up, `validation-ready`/`implemented-pending-review` →
 * in_review — instead of silently emitting nothing. The canonical vocabulary is
 * owned by `company/docs/status-frontmatter-standard.md` + its machine copy
 * `company/config/lib/frontmatter-meta.mjs` (WF-06); this hand-copied mapping is
 * pinned by the lockstep test in `SpecBacklogSource.spec.ts` (cross-repo import
 * is unavailable at source layer — noted in the order-0 plan §10).
 */
const NEXT_UP_STATUSES = new Set([
  "draft",
  "planned",
  "not-started",
  "not_started",
  "todo",
  "ready",
  "next-up",
  "next_up",
  "backlog",
  "proposed",
  "approved",
  "open",
  "blocked",
  "triaged",
]);
const IN_PROGRESS_STATUSES = new Set(["in-progress", "in_progress", "active", "building", "wip"]);
const IN_REVIEW_STATUSES = new Set(["validation-ready", "implemented-pending-review"]);

function stateForStatus(status: string | null): WorkState | null {
  if (!status) return null;
  const s = status.trim().toLowerCase();
  if (NEXT_UP_STATUSES.has(s)) return "next_up";
  if (IN_PROGRESS_STATUSES.has(s)) return "in_progress";
  if (IN_REVIEW_STATUSES.has(s)) return "in_review";
  return null; // done/shipped/deferred/archived/etc. — git owns Shipped; parked states stay off the board
}

export const specBacklogSource: WorkSignalSource = {
  id: SPEC_BACKLOG_SOURCE_ID,
  collect(ctx: CollectionContext): Promise<SignalBatch> {
    return collectPerRepo(SPEC_BACKLOG_SOURCE_ID, ctx, async (repo, c): Promise<RepoReadResult> => {
      const signals: Signal[] = [];
      const errors: SignalError[] = [];
      await collectSpecDocs(repo, c, signals, errors);
      await collectContextInProgress(repo, c, signals, errors);
      return { signals, errors };
    });
  },
};

async function collectSpecDocs(
  repo: RepoRoot,
  ctx: CollectionContext,
  signals: Signal[],
  errors: SignalError[],
): Promise<void> {
  const files = await ctx.fs.list(repo.repo, [...SPEC_GLOBS]);
  for (const file of files) {
    let text: string;
    try {
      text = await ctx.fs.readText(repo.repo, file.relPath);
    } catch (err) {
      errors.push(readError(file.relPath, err));
      continue;
    }
    const fm = parseFrontmatter(text);
    const state = stateForStatus(fm?.status ?? null);
    if (!state) continue;
    const ticketId = fm?.id ?? fm?.ticket ?? ticketFromFilename(file.relPath);
    if (!ticketId || !prefixOf(ticketId)) continue; // a doc with no ticket is an artifact, not a work item
    signals.push({
      kind: "work",
      source: SPEC_BACKLOG_SOURCE_ID,
      repo: repo.repo,
      path: file.relPath,
      mtime: file.mtime,
      confidence: state === "next_up" ? "high" : "low",
      freshness: "live",
      errors: [],
      ticketId,
      prefix: prefixOf(ticketId),
      state,
      precedence: "spec_frontmatter",
      evidence: `${file.relPath} (status: ${fm?.status ?? "?"})`,
      title: fm?.title ?? undefined,
    });
  }
}

async function collectContextInProgress(
  repo: RepoRoot,
  ctx: CollectionContext,
  signals: Signal[],
  errors: SignalError[],
): Promise<void> {
  const files = await ctx.fs.list(repo.repo, [...CONTEXT_GLOBS]);
  for (const file of files) {
    let text: string;
    try {
      text = await ctx.fs.readText(repo.repo, file.relPath);
    } catch (err) {
      errors.push(readError(file.relPath, err));
      continue;
    }
    for (const ticketId of extractContextInProgress(text)) {
      if (!prefixOf(ticketId)) continue;
      signals.push({
        kind: "work",
        source: SPEC_BACKLOG_SOURCE_ID,
        repo: repo.repo,
        path: file.relPath,
        confidence: "low",
        freshness: "live",
        errors: [],
        ticketId,
        prefix: prefixOf(ticketId),
        state: "in_progress",
        precedence: "spec_frontmatter",
        evidence: `${file.relPath} → What's In Progress`,
      });
    }
  }
}
