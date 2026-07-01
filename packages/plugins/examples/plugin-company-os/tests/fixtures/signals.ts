/**
 * Signal/bundle builders for the projection golden tests. Construct typed
 * signals directly (no collection) so the projections are tested in isolation
 * from the sources.
 */

import type { SignalBatch, SignalBundle, RepoFreshness } from "../../src/contracts/WorkSignalSource.js";
import type {
  ArtifactSignal,
  AgentSignal,
  BranchSignal,
  DocSignal,
  LineageSignal,
  RepoGitSignal,
  ReviewSignal,
  RoutineSignal,
  Signal,
  TaxonomySignal,
  TicketSignal,
  WorkSignal,
} from "../../src/contracts/signals.js";
import type { WorkSignalPrecedence, WorkState } from "../../src/contracts/vocab.js";
import { makeDocId } from "../../src/contracts/doc-index.js";

export const NOW = Date.parse("2026-06-23T12:00:00.000Z");

export function work(
  ticketId: string | null,
  state: WorkState,
  precedence: WorkSignalPrecedence,
  over: Partial<WorkSignal> = {},
): WorkSignal {
  return {
    kind: "work",
    source: over.source ?? "git-work",
    repo: over.repo ?? "juice-bar",
    confidence: over.confidence ?? "high",
    freshness: "live",
    errors: [],
    ticketId,
    prefix: over.prefix ?? (ticketId ? ticketId.replace(/-\d+[a-z]?$/, "") : null),
    state,
    precedence,
    evidence: over.evidence ?? `${ticketId ?? "?"} evidence`,
    ...over,
  };
}

export function taxon(prefix: string, family: string, l1: string, l2: string, isGeneric = false): TaxonomySignal {
  return {
    kind: "taxonomy",
    source: "prefix-registry",
    repo: "company",
    confidence: "high",
    freshness: "live",
    errors: [],
    prefix,
    family,
    l1System: l1,
    l2Subsystem: l2,
    isGeneric,
  };
}

export function review(sha: string, over: Partial<ReviewSignal> = {}): ReviewSignal {
  return {
    kind: "review",
    source: "review-report",
    repo: over.repo ?? "juice-bar",
    confidence: "high",
    freshness: "live",
    errors: [],
    sha,
    reportKind: over.reportKind ?? "cannons",
    verdict: over.verdict ?? "ship",
    generatedAt: over.generatedAt ?? "2026-06-23T11:00:00.000Z",
    ...over,
  };
}

export function artifact(relPath: string, over: Partial<ArtifactSignal> = {}): ArtifactSignal {
  return {
    kind: "artifact",
    source: "artifact",
    repo: over.repo ?? "company",
    path: relPath,
    relPath,
    mtime: over.mtime ?? "2026-06-23T10:00:00.000Z",
    confidence: "high",
    freshness: "live",
    errors: [],
    artifactType: over.artifactType ?? "spec",
    system: over.system ?? null,
    prefix: over.prefix ?? null,
    status: over.status ?? null,
    sha256: over.sha256 ?? "deadbeef",
    sizeBytes: over.sizeBytes ?? 100,
    title: over.title ?? null,
    createdBy: over.createdBy ?? null,
    ...over,
  };
}

export function routine(
  routineKey: string,
  cadence: string,
  expectedArtifactGlob: string,
  over: Partial<RoutineSignal> = {},
): RoutineSignal {
  return {
    kind: "routine",
    source: "routine-contract",
    repo: "company",
    confidence: "high",
    freshness: "live",
    errors: [],
    routineKey,
    displayName: over.displayName ?? routineKey,
    ownerAgent: over.ownerAgent ?? "CTO",
    cadence,
    expectedArtifactGlob,
    ...over,
  };
}

export function agentSignal(agentKey: string, over: Partial<AgentSignal> = {}): AgentSignal {
  return {
    kind: "agent",
    source: over.source ?? "agent",
    repo: over.repo ?? "company",
    confidence: over.confidence ?? "high",
    freshness: over.freshness ?? "live",
    errors: over.errors ?? [],
    agentKey,
    displayName: over.displayName ?? "CTO",
    role: over.role ?? "cto",
    model: over.model ?? "gpt-5.5",
    reportsTo: over.reportsTo ?? "CEO",
    budgetMonthlyCents: over.budgetMonthlyCents ?? 2000,
    canCreateAgents: over.canCreateAgents ?? false,
    maxTurnsPerRun: over.maxTurnsPerRun ?? 100,
    heartbeatIntervalSec: over.heartbeatIntervalSec ?? 86_400,
    summary: over.summary ?? null,
    duties: over.duties ?? [{ id: "technical-analysis", surface: "company/reports/analysis" }],
    handsOffTo: over.handsOffTo ?? [],
    receivesFrom: over.receivesFrom ?? ["CEO"],
    ...over,
  };
}

/** A `LineageSignal` (the whole declarative lineage graph, one signal). */
export function lineageSignal(over: Partial<LineageSignal> = {}): LineageSignal {
  return {
    kind: "lineage",
    source: over.source ?? "lineage",
    repo: over.repo ?? "company",
    confidence: over.confidence ?? "high",
    freshness: over.freshness ?? "live",
    errors: over.errors ?? [],
    laneGroups: over.laneGroups ?? [],
    edges: over.edges ?? [],
    ...over,
  };
}

/** A `TicketSignal` (one exported Paperclip issue). Defaults to an active manual ticket. */
export function ticketSignal(identifier: string, over: Partial<TicketSignal> = {}): TicketSignal {
  return {
    kind: "ticket",
    source: over.source ?? "ticket",
    repo: over.repo ?? "company",
    path: over.path ?? `reports/paperclip/tickets/${identifier}.md`,
    mtime: over.mtime ?? "2026-06-23T10:00:00.000Z",
    confidence: over.confidence ?? "high",
    freshness: over.freshness ?? "live",
    errors: over.errors ?? [],
    identifier,
    title: over.title ?? `${identifier} title`,
    description: over.description ?? "",
    status: over.status ?? "in_progress",
    priority: over.priority ?? "medium",
    originKind: over.originKind ?? "manual",
    parentId: over.parentId ?? null,
    assigneeAgentId: over.assigneeAgentId ?? null,
    referencedFamilies: over.referencedFamilies ?? [],
    ...over,
  };
}

/** Assemble a one-batch bundle from a flat signal list. */
export function bundleOf(signals: Signal[], repoFreshness: RepoFreshness[] = []): SignalBundle {
  const batch: SignalBatch = { source: "test", collectedAt: NOW, signals, repoFreshness };
  return { collectedAt: NOW, batches: [batch] };
}

/** Assemble a bundle from multiple labeled batches (for source-freshness tests). */
export function bundleOfBatches(batches: SignalBatch[]): SignalBundle {
  return { collectedAt: NOW, batches };
}

// ---------------------------------------------------------------------------
// COS-1 signal factories (git/source + docs). Carry `repo` (the repoKey) only —
// projectKey is resolved at projection time (PF-5).
// ---------------------------------------------------------------------------

/** A `BranchSignal` (per-branch git state). `branch: null` = a detached/orphaned worktree row. */
export function branchSignal(branch: string | null, over: Partial<BranchSignal> = {}): BranchSignal {
  return {
    kind: "branch",
    source: over.source ?? "branch",
    repo: over.repo ?? "juice-bar",
    confidence: over.confidence ?? "high",
    freshness: over.freshness ?? "live",
    errors: over.errors ?? [],
    branch,
    headSha: over.headSha ?? "abc1234",
    worktrees: over.worktrees ?? [],
    trunk: over.trunk ?? { ref: "origin/main", state: "ok" },
    comparison: over.comparison ?? "ok",
    ahead: over.ahead ?? 0,
    behind: over.behind ?? 0,
    conflictsWithTrunk: over.conflictsWithTrunk ?? false,
    lastCommitAt: over.lastCommitAt ?? "2026-06-23T10:00:00.000Z",
    staleDays: over.staleDays ?? 1,
    recentCommits: over.recentCommits ?? [],
    statuses: over.statuses ?? [],
    ...over,
  };
}

/** A `RepoGitSignal` (per-configured-repo header — availability + trunk). */
export function repoGitSignal(repo: string, over: Partial<RepoGitSignal> = {}): RepoGitSignal {
  return {
    kind: "repo_git",
    source: over.source ?? "branch",
    repo,
    confidence: over.confidence ?? "high",
    freshness: over.freshness ?? "live",
    errors: over.errors ?? [],
    availability: over.availability ?? "ok",
    trunk: over.trunk ?? { ref: "origin/main", state: "ok" },
    diagnostics: over.diagnostics ?? [],
    ...over,
  };
}

/** A `DocSignal` (a renderable doc, main or worktree). `checkoutKey` is the read key (PF-8). */
export function docSignal(relPath: string, over: Partial<DocSignal> = {}): DocSignal {
  const repo = over.repo ?? "company";
  const checkoutId = over.checkoutId ?? "main";
  return {
    kind: "doc",
    source: over.source ?? "docs",
    repo,
    confidence: over.confidence ?? "high",
    freshness: over.freshness ?? "live",
    errors: over.errors ?? [],
    docType: over.docType ?? "spec",
    docId: over.docId ?? makeDocId(repo, checkoutId, relPath),
    checkoutId,
    checkoutKey: over.checkoutKey ?? repo,
    worktreeName: over.worktreeName ?? null,
    relPath,
    branch: over.branch ?? null,
    title: over.title ?? null,
    status: over.status ?? null,
    prefix: over.prefix ?? null,
    verified: over.verified ?? false,
    mtime: over.mtime ?? "2026-06-23T10:00:00.000Z",
    sizeBytes: over.sizeBytes ?? 256,
    indexFingerprint: over.indexFingerprint ?? "fp:abc",
    ...over,
  };
}
