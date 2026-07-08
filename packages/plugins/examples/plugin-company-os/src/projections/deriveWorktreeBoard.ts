/**
 * `deriveWorktreeBoard` — fold `WorktreeSignal`s (+ worktree-LESS
 * `BranchSignal`s) into the Branch·PR Worktrees lens payload (COS-8c / spec
 * §5.2). Pure; validated on the way out.
 *
 * LANE LADDER (top rung wins; `rung` names the decider, `laneSource` its
 * provenance — spec §8.6):
 *   1. clean + mergeStatus direct|squash → `merged_cleanup` (item 2: the COH
 *      squash detector decides the merged lane — a dirty tree with new work
 *      on top of a merged branch is NOT cleanup).
 *   2. COH-0 Work Record present → its LATEST checkpoint is the status source
 *      (item 3): wip → `in_flight` (rung work-record:wip); pushed →
 *      `in_flight` (rung work-record:pushed). Attention overlays still apply
 *      (a work-record tree that is behind-heavy needs attention).
 *   3. Heuristics (Work-Record-absent trees only): dirty+stale-tip or
 *      behind-heavy → `needs_attention`; dirty → `in_flight`; active tip →
 *      `in_flight`; else `stale`.
 *
 * Worktree-less branches (BranchSignal with no worktrees, not the trunk) get
 * the SAME ladder minus `_purpose` — zero new git calls; their recency comes
 * from `recentCommits`/`staleDays` (Fable major 6), and the resolved rung is
 * recorded on the card.
 */

import type { SignalBundle } from "../contracts/WorkSignalSource.js";
import type { BranchSignal, Signal, WorktreeSignal } from "../contracts/signals.js";
import type { Diagnostic } from "../contracts/diagnostics.js";
import { BEHIND_WARN } from "../contracts/git-state.js";
import {
  WORKTREE_ACTIVE_DAYS,
  WORKTREE_BOARD_SCHEMA_VERSION,
  parseWorktreeBoardV1,
  type WorktreeBoardV1,
  type WorktreeCardV1,
  type WorktreeRepoSectionV1,
} from "../contracts/worktree-board.js";
import type { WorktreeLane } from "../contracts/vocab.js";
import { latestCheckpoint } from "../sources/purpose.js";
import { classifyOrigin } from "../sources/WorktreeSource.js";
import { TRUNK_CANDIDATES } from "../sources/git-helpers.js";

const MS_PER_DAY = 86_400_000;

/** Bare trunk names — branch-only cards are never minted for the trunk itself. */
const TRUNK_NAMES = new Set(TRUNK_CANDIDATES.map((t) => t.replace(/^origin\//, "")));

const DOC_RE = /\.(md|markdown)$/i;

function allSignals(bundle: SignalBundle): Signal[] {
  return bundle.batches.flatMap((b) => b.signals);
}

interface LaneDecision {
  lane: WorktreeLane;
  laneSource: WorktreeCardV1["laneSource"];
  rung: string;
}

function tipActive(lastCommitAt: string | null, nowMs: number): boolean {
  return lastCommitAt !== null && nowMs - Date.parse(lastCommitAt) < WORKTREE_ACTIVE_DAYS * MS_PER_DAY;
}

function laneOfWorktree(s: WorktreeSignal, nowMs: number): LaneDecision {
  const dirty = (s.dirtyFileCount ?? 0) > 0;
  const active = tipActive(s.lastCommitAt, nowMs);
  const behindHeavy = (s.behind ?? 0) > BEHIND_WARN;

  // 1. Merged (clean) — the COH detector owns this lane.
  if (!dirty && (s.mergeStatus === "direct" || s.mergeStatus === "squash")) {
    return { lane: "merged_cleanup", laneSource: "heuristic", rung: `merged:${s.mergeStatus}` };
  }

  // 2. Work Record — the declared status source where present.
  const latest = s.purpose ? latestCheckpoint(s.purpose) : null;
  if (latest && (latest.wip !== null || latest.pushed !== null)) {
    if (behindHeavy || (dirty && !active)) {
      return { lane: "needs_attention", laneSource: "work_record", rung: behindHeavy ? "behind-heavy" : "dirty-stale" };
    }
    if (latest.wip === true) return { lane: "in_flight", laneSource: "work_record", rung: "work-record:wip" };
    if (latest.pushed === true) return { lane: "in_flight", laneSource: "work_record", rung: "work-record:pushed" };
    return { lane: "in_flight", laneSource: "work_record", rung: "work-record:recorded" };
  }

  // 3. Heuristics — Work-Record-absent trees only.
  if (dirty && !active) return { lane: "needs_attention", laneSource: "heuristic", rung: "dirty-stale" };
  if (behindHeavy) return { lane: "needs_attention", laneSource: "heuristic", rung: "behind-heavy" };
  if (dirty) return { lane: "in_flight", laneSource: "heuristic", rung: "dirty" };
  if (active) return { lane: "in_flight", laneSource: "heuristic", rung: "tip-recent" };
  return { lane: "stale", laneSource: "heuristic", rung: "stale-tip" };
}

function cardOfWorktree(s: WorktreeSignal, nowMs: number): WorktreeCardV1 {
  const { lane, laneSource, rung } = laneOfWorktree(s, nowMs);
  const latest = s.purpose ? latestCheckpoint(s.purpose) : null;
  return {
    cardKey: s.checkoutKey,
    repoKey: s.repo,
    hasWorktree: true,
    checkoutKey: s.checkoutKey,
    worktreeName: s.worktreeName,
    branch: s.branch,
    origin: s.origin,
    lane,
    laneSource,
    rung,
    headSha: s.headSha,
    dirtyFileCount: s.dirtyFileCount,
    ahead: s.ahead,
    behind: s.behind,
    lastCommitAt: s.lastCommitAt,
    changedFiles: s.changedFiles === null ? null : [...s.changedFiles],
    changedFilesTruncated: s.changedFilesTruncated,
    mergeStatus: s.mergeStatus,
    docChangedCount: (s.changedFiles ?? []).filter((f) => DOC_RE.test(f)).length,
    ticketIds: s.purpose ? [...s.purpose.ticketIds] : [],
    slug: s.purpose?.slug ?? null,
    checkpointCount: s.purpose?.checkpoints.length ?? 0,
    latestCheckpointAt: latest?.at ?? null,
    latestWip: latest?.wip ?? null,
    latestPushed: latest?.pushed ?? null,
    activeHandoff: s.purpose?.activeHandoff ?? null,
    // Cleanup receipts (item 1): coh promote for claude/codex trees; raw git
    // ONLY for external-origin trees.
    cleanupKind: lane === "merged_cleanup" ? (s.origin === "external" ? "raw_git" : "coh_promote") : null,
  };
}

/** The intent ladder MINUS `_purpose` for a branch that has no worktree. */
function cardOfBranch(s: BranchSignal, nowMs: number): WorktreeCardV1 | null {
  if (s.branch === null) return null; // detached rows belong to worktree cards
  if (TRUNK_NAMES.has(s.branch)) return null; // the trunk is not "work in flight"
  const active = tipActive(s.lastCommitAt, nowMs);
  const behindHeavy = (s.behind ?? 0) > BEHIND_WARN;
  const conflicts = s.conflictsWithTrunk === true;
  let decision: LaneDecision;
  if (conflicts || behindHeavy) {
    decision = { lane: "needs_attention", laneSource: "heuristic", rung: conflicts ? "conflicts-predicted" : "behind-heavy" };
  } else if (active) {
    decision = { lane: "in_flight", laneSource: "heuristic", rung: "tip-recent" };
  } else {
    decision = { lane: "stale", laneSource: "heuristic", rung: "stale-tip" };
  }
  return {
    cardKey: `branch:${s.repo}:${s.branch}`,
    repoKey: s.repo,
    hasWorktree: false,
    checkoutKey: null,
    worktreeName: null,
    branch: s.branch,
    origin: classifyOrigin(s.branch, s.branch),
    lane: decision.lane,
    laneSource: decision.laneSource,
    rung: decision.rung,
    headSha: s.headSha || null,
    dirtyFileCount: null, // no working tree to be dirty
    ahead: s.ahead,
    behind: s.behind,
    lastCommitAt: s.lastCommitAt,
    changedFiles: null,
    changedFilesTruncated: false,
    mergeStatus: "unknown",
    docChangedCount: 0,
    ticketIds: [],
    slug: null,
    checkpointCount: 0,
    latestCheckpointAt: null,
    latestWip: null,
    latestPushed: null,
    activeHandoff: null,
    cleanupKind: null,
  };
}

const LANE_ORDER: Record<WorktreeLane, number> = { needs_attention: 0, in_flight: 1, merged_cleanup: 2, stale: 3 };

export function deriveWorktreeBoard(bundle: SignalBundle, nowMs: number): WorktreeBoardV1 {
  const signals = allSignals(bundle);
  const worktrees = signals.filter((s): s is WorktreeSignal => s.kind === "worktree");
  const branches = signals.filter((s): s is BranchSignal => s.kind === "branch");

  // Branches already covered by a worktree card don't get a second card.
  const worktreeBranches = new Set(worktrees.map((w) => `${w.repo}:${w.branch ?? ""}`));

  const byRepo = new Map<string, WorktreeCardV1[]>();
  const push = (card: WorktreeCardV1) => {
    const list = byRepo.get(card.repoKey) ?? [];
    list.push(card);
    byRepo.set(card.repoKey, list);
  };
  for (const s of worktrees) push(cardOfWorktree(s, nowMs));
  for (const s of branches) {
    if (s.branch !== null && worktreeBranches.has(`${s.repo}:${s.branch}`)) continue;
    if (s.worktrees.length > 0) continue; // its trees emit worktree signals
    const card = cardOfBranch(s, nowMs);
    if (card) push(card);
  }

  const diagnostics: Diagnostic[] = [];
  const repos: WorktreeRepoSectionV1[] = [...byRepo.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([repoKey, cards]) => {
      const wtCards = cards.filter((c) => c.hasWorktree);
      const evaluated = wtCards.filter((c) => c.changedFiles !== null).length;
      const skippedDirty = wtCards
        .filter((c) => (c.dirtyFileCount ?? 0) > 0 && c.changedFiles === null)
        .map((c) => c.worktreeName ?? c.cardKey)
        .sort();
      const sorted = [...cards].sort(
        (a, b) => LANE_ORDER[a.lane] - LANE_ORDER[b.lane] || (b.dirtyFileCount ?? 0) - (a.dirtyFileCount ?? 0) || a.cardKey.localeCompare(b.cardKey),
      );
      return { repoKey, evaluated, total: wtCards.length, skippedDirty, cards: sorted };
    });

  return parseWorktreeBoardV1({
    schemaVersion: WORKTREE_BOARD_SCHEMA_VERSION,
    derivedAt: new Date(nowMs).toISOString(),
    repos,
    diagnostics,
  });
}
