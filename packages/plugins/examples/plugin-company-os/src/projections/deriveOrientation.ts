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
  isDocSignal,
  isTaxonomySignal,
  isLandedPrSignal,
  isArtifactSignal,
  isBranchSignal,
  isProtectionSignal,
  isRepoGitSignal,
  isRoutineSignal,
  isWorkSignal,
  type BranchSignal,
  type WorkSignal,
} from "../contracts/signals.js";
import { GATES_SOURCE_IDS } from "../contracts/gates.js";
import type { Diagnostic } from "../contracts/diagnostics.js";
import type { ProjectTaxonomyV1 } from "../contracts/projects.js";
import { repoBadge } from "../contracts/grouping.js";
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
import type { HealthSeverity, RecentWorkKind } from "../contracts/vocab.js";
import {
  branchStatusSeverity,
  prActionStatuses,
  compareSeverityWorstFirst,
  isAttentionSeverity,
} from "../contracts/branch-health.js";
import { evaluateRoutine } from "./routine-freshness.js";
import { aggregateSourceFreshness, diagnosticsFromFreshness, isoFrom } from "./_shared.js";

/**
 * The stable role id → live routine key binding (spec §5.3, OI-3). Bound from the
 * routine-contract source (sidecars first, legacy AGENTS fallback during
 * activation); a role whose routine isn't present is skipped, so the briefing is
 * non-empty whenever ≥1 resolves. Order + membership are the 1R-a-ratified set
 * (report-cohesion audit); `health-scan` was the previously-missing COO daily pin.
 */
const PINNED_ROLE_TO_ROUTINE: Record<string, string> = {
  "daily-standup": "daily-standup",
  "health-scan": "daily-health-scan",
  "codebase-health": "daily-codebase-awareness",
  strategy: "weekly-strategic-summary",
  "process-audit": "weekly-process-enforcement",
  "weekly-summary": "weekly-report",
};

export function deriveOrientation(bundle: SignalBundle, nowMs: number, taxonomy: ProjectTaxonomyV1): OrientationV1 {
  const signals = bundle.batches.flatMap((b) => b.signals);
  const routines = signals.filter(isRoutineSignal);
  const artifacts = signals.filter(isArtifactSignal);
  const branches = signals.filter(isBranchSignal);
  const repoGits = signals.filter(isRepoGitSignal);
  const work = signals.filter(isWorkSignal);
  // Repo→project badge via the unified grouping facade (COS-5g).
  const proj = (repo: string): string => repoBadge(taxonomy, repo);
  const companyKey = taxonomy.groups.find((g) => g.kind === "company")?.key ?? taxonomy.groups[0]?.key ?? "company";

  // --- Pinned briefing (company-global) ---
  const routinesByKey = new Map(routines.map((r) => [r.routineKey, r]));
  const briefing: BriefingCardV1[] = [];
  for (const role of DEFAULT_PINNED_ROLES) {
    const routine = routinesByKey.get(PINNED_ROLE_TO_ROUTINE[role] ?? role);
    if (!routine) continue; // skip an unresolved role
    if ((routine.freshnessKind ?? "artifact") === "embedded") continue;
    const ev = evaluateRoutine(routine, artifacts, nowMs);
    briefing.push({
      routineKey: routine.routineKey,
      displayName: routine.displayName,
      ownerAgent: routine.ownerAgent,
      freshnessKind: ev.freshnessKind,
      verdict: ev.verdict,
      reportDate: ev.latest?.mtime ?? null,
      repo: ev.latest?.repo ?? routine.repo,
      relPath: ev.latest?.relPath ?? null,
    });
  }

  // --- Branch health (alert-worthy only) ---
  // COS-8a: fold each branch's open-PR action statuses in via the SAME shared
  // fold `deriveGitState` uses — Home's count stays ≡ the Branch·PR band.
  const prActionsByBranch = new Map<string, ReturnType<typeof prActionStatuses>>();
  {
    const prsByBranch = new Map<string, { isDraft: boolean; ciState: string; mergeableState: string; reviewDecision: string }[]>();
    for (const w of work) {
      if (typeof w.prNumber !== "number" || !w.headRef) continue;
      const key = `${w.repo}#${w.headRef}`;
      const list = prsByBranch.get(key) ?? [];
      list.push({
        isDraft: w.isDraft ?? false,
        ciState: w.ciState ?? "unknown",
        mergeableState: w.prMergeable ?? "unknown",
        reviewDecision: w.prReviewDecision ?? "unknown",
      });
      prsByBranch.set(key, list);
    }
    for (const [key, prs] of prsByBranch) prActionsByBranch.set(key, prActionStatuses(prs));
  }
  const branchHealth: BranchHealthEntryV1[] = branches
    .map((b): { entry: BranchHealthEntryV1; severity: HealthSeverity } => {
      const statuses = [...b.statuses, ...(b.branch !== null ? (prActionsByBranch.get(`${b.repo}#${b.branch}`) ?? []) : [])];
      const severity = branchStatusSeverity(statuses);
      return {
        severity,
        entry: {
          projectKey: proj(b.repo),
          repo: b.repo,
          branch: b.branch,
          statuses,
          severity,
          behind: b.behind,
          staleDays: b.staleDays,
          deepLink: { tab: "source", repoKey: b.repo, branch: b.branch },
        },
      };
    })
    .filter((x) => isAttentionSeverity(x.severity))
    .sort((a, b) => compareSeverityWorstFirst(a.severity, b.severity))
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
  // C3: the TBD lane — queued next_up work, deduped by ticket, newest first.
  const tbdByTicket = new Map<string, WorkSignal>();
  for (const w of work) {
    if (w.ticketId === null || w.state !== "next_up") continue;
    if (workByTicket.has(w.ticketId)) continue; // already moving (in-progress/shipped) — TBD is QUEUED only
    const prev = tbdByTicket.get(w.ticketId);
    if (!prev || (w.mtime ?? "") > (prev.mtime ?? "")) tbdByTicket.set(w.ticketId, w);
  }
  const tbdWork: RecentWorkV1[] = [...tbdByTicket.values()]
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
    if (card.verdict === null) continue;
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
  branchHealth.forEach((bh, idx) => {
    alerts.push({
      // A repo can have SEVERAL detached checkouts (branch: null); the row index
      // keeps their alert ids (and the React keys downstream) unique. Named
      // branches are one-row-per-branch, so they never collide.
      id: `branch:${bh.repo}:${bh.branch ?? `detached:${idx}`}`,
      projectKey: bh.projectKey,
      kind: "branch_at_risk",
      severity: bh.severity === "high" ? "high" : "medium",
      title: `${bh.branch ?? "(detached)"} needs attention`,
      detail: bh.statuses.join(", "),
      deepLink: bh.deepLink,
    });
  });
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

  // --- COS-11 B17 diagnostics-class lane (gates → Home) ---
  // gate_unprotected (error tier): the branch-protection drift class. The
  // codified single-admin posture is enforce_admins=false everywhere (the
  // 2026-06-23 incident class) — a desired-state file showing `true` is the
  // drift the reconciler exists to catch, surfaced within one derive tick.
  for (const p of signals.filter(isProtectionSignal)) {
    if (p.enforceAdmins !== true) continue;
    alerts.push({
      id: `gate:protection:${p.repoName}`,
      projectKey: proj(p.repoName),
      kind: "gate_unprotected",
      severity: "high",
      title: `branch protection drifted on ${p.repoName}`,
      detail: `enforce_admins=true (single-admin deadlock class) · desired false · ${p.slug}@${p.branch}`,
      deepLink: { tab: "source", repoKey: p.repoName, branch: null },
    });
  }
  // system_degraded (warn tier): a gates source itself degraded — the PIPELINE
  // needs attention (stale posture would otherwise read as all-clear).
  {
    const gatesSourceIds = new Set<string>(GATES_SOURCE_IDS);
    const seenDegraded = new Set<string>();
    for (const batch of bundle.batches) {
      if (!gatesSourceIds.has(batch.source)) continue;
      for (const rf of batch.repoFreshness) {
        // STALE freshness fires even with errors:[] — a scoped-merge rehydrates
        // cached stale rows WITHOUT their original errors (codex COS-11 P1), and
        // a stale gate posture must keep its alert across unrelated refreshes.
        const degraded = rf.errors.filter((e) => e.degraded);
        if (degraded.length === 0 && rf.freshness !== "stale") continue;
        const key = `${batch.source}:${rf.repo}`;
        if (seenDegraded.has(key)) continue;
        seenDegraded.add(key);
        alerts.push({
          id: `gate:degraded:${key}`,
          projectKey: proj(rf.repo),
          kind: "system_degraded",
          severity: "medium",
          title: `${batch.source} gate source degraded on ${rf.repo}`,
          detail: degraded.length > 0 ? degraded.map((e) => e.message).join("; ") : "stale (carried from a prior derive)",
          deepLink: { tab: "source", repoKey: rf.repo, branch: null },
        });
      }
    }
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

  // C3: momentum — distinct PRs landed in the last 7 days (repo-local numbers,
  // so key by repo#number like openPrs).
  const weekAgoMs = nowMs - 7 * 86_400_000;
  const landedThisWeek = new Set<string>();
  for (const lp of signals.filter(isLandedPrSignal)) {
    const at = Date.parse(lp.landedAt);
    if (Number.isFinite(at) && at >= weekAgoMs && at <= nowMs) landedThisWeek.add(`${lp.repo}#${lp.prNumber}`);
  }

  // C3: plan gaps — registered families with a MAIN-checkout spec doc but no plan
  // doc (the same hasSpec && !hasPlan rule the Atlas lifecycle uses).
  // ANY checkout counts (main or worktree) — the SAME rule the Atlas lifecycle
  // uses, so Home's gap count can never contradict the family card it links to
  // (codex order-0 P1: a worktree-only plan read as a gap here but "authored" there).
  const registeredPrefixes = new Set(signals.filter(isTaxonomySignal).map((s) => s.prefix));
  const specPrefixes = new Set<string>();
  const planPrefixes = new Set<string>();
  for (const d of signals.filter(isDocSignal)) {
    if (d.prefix === null) continue;
    if (d.docType === "spec") specPrefixes.add(d.prefix);
    if (d.docType === "plan") planPrefixes.add(d.prefix);
  }
  let planGaps = 0;
  for (const prefix of registeredPrefixes) {
    if (specPrefixes.has(prefix) && !planPrefixes.has(prefix)) planGaps++;
  }

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
      shippedThisWeek: landedThisWeek.size,
      planGaps,
    },
    branchHealth,
    recentCommits,
    recentWork,
    tbdWork,
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
