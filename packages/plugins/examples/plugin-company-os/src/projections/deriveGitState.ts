/**
 * `deriveGitState` — pure fold of `RepoGitSignal` (per-repo header) + `BranchSignal`
 * (per-branch state) into the project-grouped `GitStateV1` the Source tab reads
 * (spec §5.3). Project grouping is applied at projection time via the taxonomy
 * param (PF-5); a configured-but-absent repo renders an `availability:"missing"`
 * 0-row from its `RepoGitSignal`; when a group's config primary is absent-on-disk
 * but a dependency is available, `displayPrimaryRepoKey` points at the dependency
 * + a high-severity diagnostic (§5.7). The `BranchSignal` git payload is mapped to
 * the persisted `BranchGitV1` row (no source-provenance envelope — the COS-0 UI
 * import boundary).
 */

import type { SignalBundle } from "../contracts/WorkSignalSource.js";
import {
  isBranchSignal,
  isLandedPrSignal,
  isRepoGitSignal,
  isReviewSignal,
  isWorkSignal,
  type BranchSignal,
  type LandedPrSignal,
  type ReviewSignal,
  type WorkSignal,
} from "../contracts/signals.js";
import type { Diagnostic } from "../contracts/diagnostics.js";
import type { ProjectTaxonomyV1 } from "../contracts/projects.js";
import type { PrCiState, PrMergeableState, PrReviewDecision, ReviewVerdict } from "../contracts/vocab.js";
import { branchStatusSeverity, prActionStatuses } from "../contracts/branch-health.js";
import {
  GIT_STATE_SCHEMA_VERSION,
  LANDED_WINDOW_DAYS,
  headReviewsFor,
  type BranchGitV1,
  type BranchPrV1,
  type GitStateV1,
  type HeadReviewInput,
  type LandedPrV1,
  type PrReviewV1,
  type ProjectGitSectionV1,
  type RepoGitStateV1,
  prRollupKey,
  type PrRollupCacheEntryV1,
} from "../contracts/git-state.js";
import { aggregateSourceFreshness, diagnosticsFromFreshness, isoFrom } from "./_shared.js";
import { PULL_REQUEST_SOURCE_ID } from "../sources/PullRequestSource.js";

export function deriveGitState(bundle: SignalBundle, nowMs: number, taxonomy: ProjectTaxonomyV1): GitStateV1 {
  const signals = bundle.batches.flatMap((b) => b.signals);
  const repoGits = signals.filter(isRepoGitSignal);
  const branches = signals.filter(isBranchSignal);
  // PR + review signals (PullRequestSource / ReviewReportSource). The board folds
  // these too; here they enrich each branch row with its open-PR lifecycle + joined
  // review state (COS-5e). A PR signal is a work signal carrying a prNumber; a
  // multi-ticket PR fans into several signals, so the collector dedups by number.
  // Gate on the pull-request SOURCE, not just prNumber presence — legacy cached
  // slices from other sources can carry stale prNumber fields and pollute the
  // branch rows with long-merged PRs (same class as Home's 227-vs-26 openPrs).
  const prSignals = signals
    .filter(isWorkSignal)
    .filter((w) => w.source === PULL_REQUEST_SOURCE_ID && typeof w.prNumber === "number");
  const reviews = signals.filter(isReviewSignal);
  // COS-8b: recently-landed PRs are a DISTINCT signal kind (inert to the board /
  // Atlas work folds); this projection is their only consumer.
  const landedByRepo = collectLandedByRepo(signals.filter(isLandedPrSignal), nowMs);
  // COS-8d: the branch-tip review join input (a ReviewSignal minus its envelope).
  const headReviewInputs: HeadReviewInput[] = reviews.map((r) => ({
    repo: r.repo,
    sha: r.sha,
    reportKind: r.reportKind,
    verdict: r.verdict,
    generatedAt: r.generatedAt,
    ...(r.p0 !== undefined ? { p0: r.p0 } : {}),
    ...(r.p1 !== undefined ? { p1: r.p1 } : {}),
    ...(r.p2 !== undefined ? { p2: r.p2 } : {}),
  }));

  const branchesByRepo = new Map<string, BranchSignal[]>();
  for (const b of branches) {
    const list = branchesByRepo.get(b.repo) ?? [];
    list.push(b);
    branchesByRepo.set(b.repo, list);
  }
  const prsByRepo = collectPullRequestsByRepo(prSignals, reviews);

  // One RepoGitStateV1 per repoGit header signal (the carrier for absent repos).
  const repoStates = new Map<string, RepoGitStateV1>();
  for (const rg of repoGits) {
    const repoPrs = prsByRepo.get(rg.repo) ?? [];
    const repoBranches =
      rg.availability === "ok"
        ? (branchesByRepo.get(rg.repo) ?? [])
            .map((b) => toBranchGitV1(b, repoPrs, headReviewInputs))
            .sort((a, b) => branchSortKey(a).localeCompare(branchSortKey(b)))
        : [];
    // A PR whose head ref matches NO local branch (branch on another machine, deleted
    // locally, or a null head ref) is an orphan — kept visible, never dropped (show-0
    // honesty). An available repo with no local branches surfaces all its PRs here.
    const localNames = new Set(repoBranches.map((b) => b.branch).filter((n): n is string => n !== null));
    const orphanPullRequests = repoPrs.filter((pr) => pr.headRef === null || !localNames.has(pr.headRef));
    repoStates.set(rg.repo, {
      repoKey: rg.repo,
      role: "primary", // overwritten per group membership below
      availability: rg.availability,
      trunk: { ref: rg.trunk.ref, state: rg.trunk.state },
      branches: repoBranches,
      orphanPullRequests,
      landedPullRequests: landedByRepo.get(rg.repo) ?? [],
    });
  }

  // Surface the per-repo header diagnostics (git budget exceeded / read failed /
  // trunk missing) from BranchSource so the UI can render them.
  const diagnostics: Diagnostic[] = [...taxonomy.diagnostics, ...repoGits.flatMap((rg) => [...rg.diagnostics])];
  const groups: ProjectGitSectionV1[] = [];

  for (const group of [...taxonomy.groups].sort((a, b) => a.order - b.order)) {
    const repos: RepoGitStateV1[] = group.repos.map((member) => {
      const state = repoStates.get(member.repoKey);
      if (state) return { ...state, role: member.role };
      // Member in the taxonomy but no header signal (a configured-but-unscanned
      // repo) — render an honest absent 0-row.
      return {
        repoKey: member.repoKey,
        role: member.role,
        availability: "missing",
        trunk: { ref: null, state: "missing" },
        branches: [],
        orphanPullRequests: [],
        landedPullRequests: [],
      };
    });

    // displayPrimaryRepoKey: config primary absent-on-disk but a dependency available.
    const primaryMember = group.repos.find((r) => r.role === "primary");
    let displayPrimaryRepoKey: string | undefined;
    if (primaryMember) {
      const primaryState = repos.find((r) => r.repoKey === primaryMember.repoKey);
      if (primaryState && primaryState.availability !== "ok") {
        const fallback = repos.find((r) => r.repoKey !== primaryMember.repoKey && r.availability === "ok");
        if (fallback) {
          displayPrimaryRepoKey = fallback.repoKey;
          diagnostics.push({
            level: "error",
            code: "misconfigured_project",
            message: `project "${group.key}" primary "${primaryMember.repoKey}" is absent-on-disk; displaying "${fallback.repoKey}"`,
            repo: primaryMember.repoKey,
            source: "git-state",
          });
        }
      }
    }

    groups.push({ group, ...(displayPrimaryRepoKey ? { displayPrimaryRepoKey } : {}), repos });
  }

  const sources = aggregateSourceFreshness(bundle);

  // The COS-11.gh-fields rollup cache: rebuilt from THIS derive's open PRs (a
  // closed PR drops out with its signal), persisted so the next derive's
  // PullRequestSource (via ctx.prior) re-fetches only changed PRs.
  // ONLY cache-worthy rollups persist (codex COS-8-ops P1): a deferred/failed/
  // stale-fallback value written under the CURRENT (headSha, updatedAt) key
  // would read "unchanged" next tick and never refetch — starvation. Omission
  // = uncached = the next derive fetches it.
  const freshRollupKeys = new Set<string>();
  for (const w of signals.filter(isWorkSignal)) {
    if (typeof w.prNumber === "number" && w.prRollupFresh === true) freshRollupKeys.add(prRollupKey(w.repo, w.prNumber));
  }
  const prRollups: Record<string, PrRollupCacheEntryV1> = {};
  for (const [repoKey, prs] of prsByRepo) {
    for (const pr of prs) {
      const key = prRollupKey(repoKey, pr.prNumber);
      if (!freshRollupKeys.has(key)) continue;
      prRollups[key] = {
        repoKey,
        prNumber: pr.prNumber,
        headSha: pr.headSha,
        updatedAt: pr.updatedAt,
        ciState: pr.ciState,
        mergeableState: pr.mergeableState,
      };
    }
  }

  return {
    schemaVersion: GIT_STATE_SCHEMA_VERSION,
    derivedAt: isoFrom(nowMs),
    taxonomy,
    groups,
    sources,
    diagnostics: [...diagnostics, ...diagnosticsFromFreshness(sources)],
    prRollups,
  };
}

/** Map a BranchSignal's git payload → the persisted BranchGitV1 row (drop provenance). */
function toBranchGitV1(b: BranchSignal, repoPrs: readonly BranchPrV1[], headReviews: readonly HeadReviewInput[]): BranchGitV1 {
  // Open PRs whose head ref is this branch (COS-5e). A detached HEAD (branch===null)
  // can't match a head ref, so it carries no PRs.
  const pullRequests = b.branch === null ? [] : repoPrs.filter((pr) => pr.headRef === b.branch);
  // COS-8a: the branch accrues its PRs' action statuses (the one shared fold).
  const statuses = [...b.statuses, ...prActionStatuses(pullRequests)];
  return {
    branch: b.branch,
    headSha: b.headSha,
    worktrees: b.worktrees.map((w) => ({
      name: basenameOf(w.path), // basename only — never the abs host path (codex B P1)
      headSha: w.headSha,
      detached: w.detached,
      dirtyFileCount: w.dirtyFileCount,
    })),
    trunk: { ref: b.trunk.ref, state: b.trunk.state },
    comparison: b.comparison,
    ahead: b.ahead,
    behind: b.behind,
    conflictsWithTrunk: b.conflictsWithTrunk,
    lastCommitAt: b.lastCommitAt,
    staleDays: b.staleDays,
    recentCommits: b.recentCommits.map((c) => ({
      sha: c.sha,
      subject: c.subject,
      author: c.author,
      committedAt: c.committedAt,
      ...(c.stat ? { stat: { ...c.stat } } : {}),
    })),
    statuses,
    // Worst-of-statuses severity via the SAME shared function deriveOrientation
    // uses for Home — computed over the COMBINED list (git + PR-action statuses)
    // so the tab rail and Home read one ladder (COS-8a).
    attentionSeverity: branchStatusSeverity(statuses),
    pullRequests,
    // COS-8d: reports joined to THIS tip by the pre-push sha rule (shared fold).
    reviewsForHead: headReviewsFor(b.repo, b.headSha, headReviews),
  };
}

/**
 * Fold `LandedPrSignal`s into per-repo lane rows (COS-8b): window-filter to
 * `LANDED_WINDOW_DAYS` against the derive clock, dedup by `{repo, prNumber}`
 * (the source emits one signal per PR, but a doubled batch must not double the
 * lane), newest-landed first. An unparseable `landedAt` fails the window check
 * and drops out — a row with no clock can't claim recency.
 */
function collectLandedByRepo(landed: readonly LandedPrSignal[], nowMs: number): Map<string, LandedPrV1[]> {
  const windowMs = LANDED_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const seen = new Set<string>();
  const byRepo = new Map<string, LandedPrV1[]>();
  for (const s of landed) {
    const t = Date.parse(s.landedAt);
    // Future timestamps are dropped too (CodeRabbit TRIPLE P2): a skewed/malformed
    // future landedAt would otherwise read as forever-fresh in the lane.
    if (!Number.isFinite(t) || t > nowMs || nowMs - t > windowMs) continue;
    const key = `${s.repo}#${s.prNumber}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const list = byRepo.get(s.repo) ?? [];
    list.push({
      prNumber: s.prNumber,
      title: s.title,
      url: s.url,
      headRef: s.headRef,
      landedAt: s.landedAt,
      via: s.via,
      ticketIds: [...s.ticketIds],
    });
    byRepo.set(s.repo, list);
  }
  for (const list of byRepo.values()) {
    list.sort((a, b) => b.landedAt.localeCompare(a.landedAt) || b.prNumber - a.prNumber);
  }
  return byRepo;
}

/**
 * Collect open PRs per repo, deduped by `{repo, prNumber}` (a multi-ticket PR fans
 * into one WorkSignal per ticket — merge their ticketIds into one row) and joined
 * with their review report. Keyed by repo so the repo builder attaches each PR to
 * its head branch or surfaces it as an orphan; newest-updated first within a repo.
 */
function collectPullRequestsByRepo(
  prSignals: readonly WorkSignal[],
  reviews: readonly ReviewSignal[],
): Map<string, BranchPrV1[]> {
  interface Acc {
    repo: string;
    prNumber: number;
    title: string | null;
    url: string | null;
    isDraft: boolean;
    headRef: string | null;
    headSha: string | null;
    updatedAt: string | null;
    ticketIds: string[];
    ciState: PrCiState;
    mergeableState: PrMergeableState;
    reviewDecision: PrReviewDecision;
  }
  const byKey = new Map<string, Acc>();
  for (const w of prSignals) {
    if (typeof w.prNumber !== "number") continue;
    const key = `${w.repo}#${w.prNumber}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        repo: w.repo,
        prNumber: w.prNumber,
        title: w.title ?? null,
        url: w.url ?? null,
        isDraft: w.isDraft ?? false,
        headRef: w.headRef ?? null,
        headSha: w.sha ?? null,
        updatedAt: w.mtime ?? null,
        ticketIds: w.ticketId ? [w.ticketId] : [],
        ciState: w.ciState ?? "unknown",
        mergeableState: w.prMergeable ?? "unknown",
        reviewDecision: w.prReviewDecision ?? "unknown",
      });
      continue;
    }
    // Merge the fan-out siblings: union ticketIds, fill any field the first lacked.
    if (w.ticketId && !existing.ticketIds.includes(w.ticketId)) existing.ticketIds.push(w.ticketId);
    existing.title ??= w.title ?? null;
    existing.url ??= w.url ?? null;
    existing.headRef ??= w.headRef ?? null;
    existing.headSha ??= w.sha ?? null;
    existing.updatedAt ??= w.mtime ?? null;
    // Fan-out siblings carry the SAME rollup; prefer any non-unknown value.
    if (existing.ciState === "unknown" && w.ciState) existing.ciState = w.ciState;
    if (existing.mergeableState === "unknown" && w.prMergeable) existing.mergeableState = w.prMergeable;
    if (existing.reviewDecision === "unknown" && w.prReviewDecision) existing.reviewDecision = w.prReviewDecision;
  }

  const byRepo = new Map<string, BranchPrV1[]>();
  for (const acc of byKey.values()) {
    const pr: BranchPrV1 = {
      prNumber: acc.prNumber,
      title: acc.title,
      url: acc.url,
      isDraft: acc.isDraft,
      headRef: acc.headRef,
      headSha: acc.headSha,
      updatedAt: acc.updatedAt,
      ticketIds: acc.ticketIds,
      review: reviewForPr(acc.repo, acc.prNumber, acc.headSha, reviews),
      ciState: acc.ciState,
      mergeableState: acc.mergeableState,
      reviewDecision: acc.reviewDecision,
    };
    const list = byRepo.get(acc.repo) ?? [];
    list.push(pr);
    byRepo.set(acc.repo, list);
  }
  for (const list of byRepo.values()) {
    list.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") || b.prNumber - a.prNumber);
  }
  return byRepo;
}

/**
 * The review joined onto a PR: a head-current report (report sha === PR head oid)
 * wins — it pertains to what's open now — else the latest older report for the same
 * PR number, marked `current: false`. Reports join by sha OR prNumber; a report with
 * neither can't be attributed to this PR (left to the docs viewer). Absent ⇒ null
 * (unknown, never "unreviewed" — reports are gitignored + machine-local).
 */
function reviewForPr(
  repo: string,
  prNumber: number,
  headSha: string | null,
  reviews: readonly ReviewSignal[],
): PrReviewV1 | null {
  const candidates = reviews.filter(
    (r) => r.repo === repo && ((headSha !== null && r.sha === headSha) || r.prNumber === prNumber),
  );
  if (candidates.length === 0) return null;
  const headCurrent = headSha !== null ? candidates.filter((r) => r.sha === headSha) : [];
  const pool = headCurrent.length > 0 ? headCurrent : candidates;
  const best = pool.reduce((a, b) => (compareReviewPreference(b, a) > 0 ? b : a));
  return {
    verdict: best.verdict,
    reportKind: best.reportKind,
    generatedAt: best.generatedAt,
    current: headSha !== null && best.sha === headSha,
    p0: best.p0 ?? null,
    p1: best.p1 ?? null,
    p2: best.p2 ?? null,
  };
}

/** How concerning a verdict is — the tie-break when two reports share a timestamp. */
const VERDICT_CONCERN: Record<ReviewVerdict, number> = { block: 4, revise: 3, unknown: 2, proceed: 1, ship: 0 };

/**
 * Deterministic report preference: newest `generatedAt` wins; on an identical timestamp the
 * MORE-concerning verdict wins (a same-instant block outranks a ship). This makes the join
 * independent of the signal batch's array order (codex/Opus P2), and conservative on ties.
 */
function compareReviewPreference(x: ReviewSignal, y: ReviewSignal): number {
  const t = x.generatedAt.localeCompare(y.generatedAt);
  if (t !== 0) return t;
  return VERDICT_CONCERN[x.verdict] - VERDICT_CONCERN[y.verdict];
}

/** Stable branch ordering: named branches first (alpha), detached worktrees last. */
function branchSortKey(b: BranchGitV1): string {
  return b.branch ?? `~detached:${b.headSha}`;
}

/** The last non-empty path segment — the worktree dir basename (no abs path leaks). */
function basenameOf(p: string): string {
  const parts = p.split("/").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : p;
}
