/**
 * `deriveOrientation` — pure fold producing the Home (default landing) digest
 * `OrientationV1` (spec §5.3): a pinned routine briefing, a current-snapshot
 * metrics strip, alert-worthy branch health, a recent-commits glance, recent
 * cross-session work, and the unified alerts union. Home DIGESTS the same signals
 * the other projections fold (never re-derives); the full per-branch detail lives
 * in `GitStateV1`. Children carry `projectKey` (resolved at projection time, PF-5)
 * so Home groups by family; the briefing is company-global (no projectKey).
 */

import type { SignalBundle } from "../contracts/WorkSignalSource.js";
import {
  isArtifactSignal,
  isBranchSignal,
  isRepoGitSignal,
  isRoutineSignal,
  isWorkSignal,
  type BranchSignal,
  type WorkSignal,
} from "../contracts/signals.js";
import type { Diagnostic } from "../contracts/diagnostics.js";
import { projectKeyForRepo, type ProjectTaxonomyV1 } from "../contracts/projects.js";
import { makeDocId } from "../contracts/doc-index.js";
import { STALE_WARN } from "../contracts/git-state.js";
import {
  DEFAULT_PINNED_ROLES,
  HOME_RECENT_COMMITS_LIMIT,
  HOME_RECENT_WORK_LIMIT,
  ORIENTATION_SCHEMA_VERSION,
  type BranchHealthEntryV1,
  type BriefingCardV1,
  type CommitGlanceV1,
  type DeepLink,
  type OrientationAlertV1,
  type OrientationV1,
  type RecentWorkV1,
} from "../contracts/orientation.js";
import type { BranchStatus, HealthSeverity, RecentWorkKind } from "../contracts/vocab.js";
import { evaluateRoutine } from "./routine-freshness.js";
import { aggregateSourceFreshness, diagnosticsFromFreshness, isoFrom } from "./_shared.js";

/**
 * The stable role id → live routine key binding (spec §5.3, OI-3). Bound from the
 * AGENTS `company_os:` blocks (verified live 2026-06-26); a role whose routine
 * isn't present is skipped, so the briefing is non-empty whenever ≥1 resolves.
 */
const PINNED_ROLE_TO_ROUTINE: Record<string, string> = {
  "daily-standup": "daily-standup",
  "codebase-health": "daily-codebase-awareness",
  strategy: "weekly-strategic-summary",
  "weekly-summary": "weekly-report",
  "process-audit": "weekly-process-enforcement",
};

const STATUS_SEVERITY: Record<BranchStatus, HealthSeverity> = {
  conflicting: "high",
  behind: "medium",
  stale: "medium",
  dirty: "medium",
  unmerged_orphan: "medium",
  orphaned_worktree: "low",
  comparison_unavailable: "low",
  conflict_not_evaluated: "low",
  ahead_clean: "info",
};
const SEVERITY_RANK: Record<HealthSeverity, number> = { high: 3, medium: 2, low: 1, info: 0 };

export function deriveOrientation(bundle: SignalBundle, nowMs: number, taxonomy: ProjectTaxonomyV1): OrientationV1 {
  const signals = bundle.batches.flatMap((b) => b.signals);
  const routines = signals.filter(isRoutineSignal);
  const artifacts = signals.filter(isArtifactSignal);
  const branches = signals.filter(isBranchSignal);
  const repoGits = signals.filter(isRepoGitSignal);
  const work = signals.filter(isWorkSignal);
  const proj = (repo: string): string => projectKeyForRepo(taxonomy, repo);
  const companyKey = taxonomy.groups.find((g) => g.kind === "company")?.key ?? taxonomy.groups[0]?.key ?? "company";

  // --- Pinned briefing (company-global) ---
  const routinesByKey = new Map(routines.map((r) => [r.routineKey, r]));
  const briefing: BriefingCardV1[] = [];
  for (const role of DEFAULT_PINNED_ROLES) {
    const routine = routinesByKey.get(PINNED_ROLE_TO_ROUTINE[role] ?? role);
    if (!routine) continue; // skip an unresolved role
    const ev = evaluateRoutine(routine, artifacts, nowMs);
    briefing.push({
      routineKey: routine.routineKey,
      displayName: routine.displayName,
      ownerAgent: routine.ownerAgent,
      verdict: ev.verdict,
      reportDate: ev.latest?.mtime ?? null,
      repo: ev.latest?.repo ?? routine.repo,
      relPath: ev.latest?.relPath ?? null,
    });
  }

  // --- Branch health (alert-worthy only) ---
  const branchHealth: BranchHealthEntryV1[] = branches
    .map((b): { entry: BranchHealthEntryV1; severity: HealthSeverity } => {
      const severity = severityOf(b.statuses);
      return {
        severity,
        entry: {
          projectKey: proj(b.repo),
          repo: b.repo,
          branch: b.branch,
          statuses: [...b.statuses],
          severity,
          behind: b.behind,
          staleDays: b.staleDays,
          deepLink: { tab: "source", repoKey: b.repo, branch: b.branch },
        },
      };
    })
    .filter((x) => x.severity === "high" || x.severity === "medium")
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])
    .map((x) => x.entry);

  // --- Recent commits glance (newest, deduped by sha, capped) ---
  const recentCommits: CommitGlanceV1[] = [];
  const seenSha = new Set<string>();
  for (const c of branches
    .flatMap((b) => b.recentCommits.map((commit) => ({ b, commit })))
    .sort((x, y) => y.commit.committedAt.localeCompare(x.commit.committedAt))) {
    if (seenSha.has(c.commit.sha)) continue;
    seenSha.add(c.commit.sha);
    recentCommits.push({
      projectKey: proj(c.b.repo),
      repo: c.b.repo,
      branch: c.b.branch,
      sha: c.commit.sha,
      subject: c.commit.subject,
      committedAt: c.commit.committedAt,
    });
    if (recentCommits.length >= HOME_RECENT_COMMITS_LIMIT) break;
  }

  // --- Recent work (in-progress + recently-shipped, deduped by ticket, capped) ---
  const workByTicket = new Map<string, WorkSignal>();
  for (const w of work) {
    if (w.ticketId === null) continue;
    if (w.state !== "in_progress" && !(w.state === "shipped" && w.reverted !== true)) continue;
    const prev = workByTicket.get(w.ticketId);
    if (!prev || (w.mtime ?? "") > (prev.mtime ?? "")) workByTicket.set(w.ticketId, w);
  }
  const recentWork: RecentWorkV1[] = [...workByTicket.values()]
    .sort((a, b) => (b.mtime ?? "").localeCompare(a.mtime ?? ""))
    .slice(0, HOME_RECENT_WORK_LIMIT)
    .map((w) => ({
      projectKey: proj(w.repo),
      system: w.prefix ?? "General",
      kind: workKind(w),
      title: w.title ?? w.ticketId ?? w.evidence,
      status: w.state,
      updatedAt: w.mtime ?? isoFrom(nowMs),
      deepLink: { tab: "board", workId: w.ticketId ?? w.evidence },
    }));

  // --- Unified alerts (routines + branches + stale work) ---
  const alerts: OrientationAlertV1[] = [];
  for (const card of briefing) {
    if (card.verdict !== "stale" && card.verdict !== "missing") continue;
    const isMissing = card.verdict === "missing";
    alerts.push({
      id: `routine:${card.routineKey}`,
      projectKey: companyKey,
      kind: isMissing ? "routine_missing" : "routine_stale",
      severity: isMissing ? "high" : "medium",
      title: `${card.displayName} ${isMissing ? "is missing its report" : "is stale"}`,
      detail: `${card.ownerAgent} · ${card.routineKey}`,
      deepLink: routineDeepLink(card),
    });
  }
  for (const bh of branchHealth) {
    alerts.push({
      id: `branch:${bh.repo}:${bh.branch ?? "detached"}`,
      projectKey: bh.projectKey,
      kind: "branch_at_risk",
      severity: bh.severity === "high" ? "high" : "medium",
      title: `${bh.branch ?? "(detached)"} needs attention`,
      detail: bh.statuses.join(", "),
      deepLink: bh.deepLink,
    });
  }
  for (const w of workByTicket.values()) {
    if (w.state !== "in_progress") continue;
    const ageDays = w.mtime ? Math.floor((nowMs - Date.parse(w.mtime)) / 86_400_000) : 0;
    if (!Number.isFinite(ageDays) || ageDays <= STALE_WARN) continue;
    alerts.push({
      id: `work:${w.ticketId}`,
      projectKey: proj(w.repo),
      kind: "work_stale",
      severity: "medium",
      title: `${w.ticketId} has been in progress ${ageDays}d`,
      detail: w.title ?? w.evidence,
      deepLink: { tab: "board", workId: w.ticketId ?? w.evidence },
    });
  }

  // --- Metrics (current snapshot, directly from signals) ---
  // PR numbers are repo-local, so key the open-PR set by repo#number — else
  // juice-bar#12 and paperclip#12 collapse to one (codex A P1).
  const openPrs = new Set<string>();
  const inProgress = new Set<string>();
  for (const w of work) {
    if (typeof w.prNumber === "number" && w.state !== "shipped") openPrs.add(`${w.repo}#${w.prNumber}`);
    if (w.state === "in_progress" && w.ticketId) inProgress.add(w.ticketId);
  }
  let dirtyWorktrees = 0;
  for (const b of branches) for (const wt of b.worktrees) if ((wt.dirtyFileCount ?? 0) > 0) dirtyWorktrees++;

  const sources = aggregateSourceFreshness(bundle);
  return {
    schemaVersion: ORIENTATION_SCHEMA_VERSION,
    derivedAt: isoFrom(nowMs),
    taxonomy,
    briefing,
    metrics: {
      openPrs: openPrs.size,
      inProgress: inProgress.size,
      alerts: alerts.length,
      branchesNeedingAttention: branchHealth.length,
      dirtyWorktrees,
    },
    branchHealth,
    recentCommits,
    recentWork,
    alerts,
    sources,
    // Fold the per-repo git-header diagnostics (git budget exceeded / read failed)
    // so a budget-exhausted repo is NEVER an invisible "all clear" on Home — its
    // branches drop out of branchHealth (severity low), so without this the Home
    // shows no alert, no badge, no diagnostic (Joe red-line; Opus review).
    diagnostics: [
      ...taxonomy.diagnostics,
      ...repoGits.flatMap((rg) => rg.diagnostics.filter((d) => d.level === "error" || d.level === "warn")),
      ...diagnosticsFromFreshness(sources),
    ],
  };
}

function severityOf(statuses: readonly BranchStatus[]): HealthSeverity {
  let best: HealthSeverity = "info";
  for (const s of statuses) {
    if (SEVERITY_RANK[STATUS_SEVERITY[s]] > SEVERITY_RANK[best]) best = STATUS_SEVERITY[s];
  }
  return best;
}

function workKind(w: WorkSignal): RecentWorkKind {
  if (typeof w.prNumber === "number") return "pr";
  if (w.precedence === "spec_frontmatter") return "spec";
  return "ticket";
}

/** A routine report's deep-link: to its rendered doc when an artifact exists, else the board. */
function routineDeepLink(card: BriefingCardV1): DeepLink {
  if (card.relPath) return { tab: "docs", docId: makeDocId(card.repo, "main", card.relPath) };
  return { tab: "board", workId: card.routineKey };
}
