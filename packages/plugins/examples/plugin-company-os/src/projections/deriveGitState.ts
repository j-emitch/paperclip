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
import { isBranchSignal, isRepoGitSignal, type BranchSignal } from "../contracts/signals.js";
import type { Diagnostic } from "../contracts/diagnostics.js";
import type { ProjectTaxonomyV1 } from "../contracts/projects.js";
import {
  GIT_STATE_SCHEMA_VERSION,
  type BranchGitV1,
  type GitStateV1,
  type ProjectGitSectionV1,
  type RepoGitStateV1,
} from "../contracts/git-state.js";
import { aggregateSourceFreshness, diagnosticsFromFreshness, isoFrom } from "./_shared.js";

export function deriveGitState(bundle: SignalBundle, nowMs: number, taxonomy: ProjectTaxonomyV1): GitStateV1 {
  const signals = bundle.batches.flatMap((b) => b.signals);
  const repoGits = signals.filter(isRepoGitSignal);
  const branches = signals.filter(isBranchSignal);

  const branchesByRepo = new Map<string, BranchSignal[]>();
  for (const b of branches) {
    const list = branchesByRepo.get(b.repo) ?? [];
    list.push(b);
    branchesByRepo.set(b.repo, list);
  }

  // One RepoGitStateV1 per repoGit header signal (the carrier for absent repos).
  const repoStates = new Map<string, RepoGitStateV1>();
  for (const rg of repoGits) {
    const repoBranches =
      rg.availability === "ok"
        ? (branchesByRepo.get(rg.repo) ?? [])
            .map(toBranchGitV1)
            .sort((a, b) => branchSortKey(a).localeCompare(branchSortKey(b)))
        : [];
    repoStates.set(rg.repo, {
      repoKey: rg.repo,
      role: "primary", // overwritten per group membership below
      availability: rg.availability,
      trunk: { ref: rg.trunk.ref, state: rg.trunk.state },
      branches: repoBranches,
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
function toBranchGitV1(b: BranchSignal): BranchGitV1 {
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
