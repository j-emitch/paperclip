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
  isRepoGitSignal,
  isReviewSignal,
  isWorkSignal,
  type BranchSignal,
  type ReviewSignal,
  type WorkSignal,
} from "../contracts/signals.js";
import type { Diagnostic } from "../contracts/diagnostics.js";
import type { ProjectTaxonomyV1 } from "../contracts/projects.js";
import { branchStatusSeverity } from "../contracts/branch-health.js";
import {
  GIT_STATE_SCHEMA_VERSION,
  type BranchGitV1,
  type BranchPrV1,
  type GitStateV1,
  type PrReviewV1,
  type ProjectGitSectionV1,
  type RepoGitStateV1,
} from "../contracts/git-state.js";
import { aggregateSourceFreshness, diagnosticsFromFreshness, isoFrom } from "./_shared.js";

export function deriveGitState(bundle: SignalBundle, nowMs: number, taxonomy: ProjectTaxonomyV1): GitStateV1 {
  const signals = bundle.batches.flatMap((b) => b.signals);
  const repoGits = signals.filter(isRepoGitSignal);
  const branches = signals.filter(isBranchSignal);
  // PR + review signals (PullRequestSource / ReviewReportSource). The board folds
  // these too; here they enrich each branch row with its open-PR lifecycle + joined
  // review state (COS-5e). A PR signal is a work signal carrying a prNumber; a
  // multi-ticket PR fans into several signals, so the collector dedups by number.
  const prSignals = signals.filter(isWorkSignal).filter((w) => typeof w.prNumber === "number");
  const reviews = signals.filter(isReviewSignal);

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
            .map((b) => toBranchGitV1(b, repoPrs))
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
  return {
    schemaVersion: GIT_STATE_SCHEMA_VERSION,
    derivedAt: isoFrom(nowMs),
    taxonomy,
    groups,
    sources,
    diagnostics: [...diagnostics, ...diagnosticsFromFreshness(sources)],
  };
}

/** Map a BranchSignal's git payload → the persisted BranchGitV1 row (drop provenance). */
function toBranchGitV1(b: BranchSignal, repoPrs: readonly BranchPrV1[]): BranchGitV1 {
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
    statuses: [...b.statuses],
    // Worst-of-statuses severity, computed once here via the SAME shared function
    // deriveOrientation uses for Home — persisted so the browser never recomputes it.
    attentionSeverity: branchStatusSeverity(b.statuses),
    // Open PRs whose head ref is this branch (COS-5e). A detached HEAD (branch===null)
    // can't match a head ref, so it carries no PRs.
    pullRequests: b.branch === null ? [] : repoPrs.filter((pr) => pr.headRef === b.branch),
  };
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
  const best = pool.reduce((a, b) => (b.generatedAt.localeCompare(a.generatedAt) > 0 ? b : a));
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

/** Stable branch ordering: named branches first (alpha), detached worktrees last. */
function branchSortKey(b: BranchGitV1): string {
  return b.branch ?? `~detached:${b.headSha}`;
}

/** The last non-empty path segment — the worktree dir basename (no abs path leaks). */
function basenameOf(p: string): string {
  const parts = p.split("/").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : p;
}
