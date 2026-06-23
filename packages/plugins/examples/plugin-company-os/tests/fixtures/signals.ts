/**
 * Signal/bundle builders for the projection golden tests. Construct typed
 * signals directly (no collection) so the projections are tested in isolation
 * from the sources.
 */

import type { SignalBatch, SignalBundle, RepoFreshness } from "../../src/contracts/WorkSignalSource.js";
import type {
  ArtifactSignal,
  ReviewSignal,
  RoutineSignal,
  Signal,
  TaxonomySignal,
  WorkSignal,
} from "../../src/contracts/signals.js";
import type { WorkSignalPrecedence, WorkState } from "../../src/contracts/vocab.js";

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

/** Assemble a one-batch bundle from a flat signal list. */
export function bundleOf(signals: Signal[], repoFreshness: RepoFreshness[] = []): SignalBundle {
  const batch: SignalBatch = { source: "test", collectedAt: NOW, signals, repoFreshness };
  return { collectedAt: NOW, batches: [batch] };
}

/** Assemble a bundle from multiple labeled batches (for source-freshness tests). */
export function bundleOfBatches(batches: SignalBatch[]): SignalBundle {
  return { collectedAt: NOW, batches };
}
