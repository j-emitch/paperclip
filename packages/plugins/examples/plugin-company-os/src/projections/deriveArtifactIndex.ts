/**
 * `deriveArtifactIndex` — pure fold of `ArtifactSignal`s into the persisted
 * `ArtifactIndexV1` the Reports + Agents tabs read. One entry per
 * (repo, relPath); `countsByType` is the sparse per-type tally for the filter
 * chips. No I/O — the signals were already collected.
 */

import type { SignalBundle } from "../contracts/WorkSignalSource.js";
import { isArtifactSignal, type ArtifactSignal } from "../contracts/signals.js";
import {
  ARTIFACT_INDEX_SCHEMA_VERSION,
  type ArtifactEntry,
  type ArtifactIndexV1,
} from "../contracts/artifact-index.js";
import type { ArtifactType } from "../contracts/vocab.js";
import { aggregateSourceFreshness, diagnosticsFromFreshness, isoFrom } from "./_shared.js";

export function deriveArtifactIndex(bundle: SignalBundle, nowMs: number): ArtifactIndexV1 {
  const artifacts: ArtifactSignal[] = bundle.batches.flatMap((b) => b.signals.filter(isArtifactSignal));

  // Dedupe by (repo, relPath); the newest mtime wins if a file is seen twice.
  const byKey = new Map<string, ArtifactSignal>();
  for (const a of artifacts) {
    const key = JSON.stringify([a.repo, a.relPath]);
    const prev = byKey.get(key);
    if (!prev || (a.mtime ?? "") > (prev.mtime ?? "")) byKey.set(key, a);
  }

  const entries: ArtifactEntry[] = [...byKey.values()]
    .map(
      (a): ArtifactEntry => ({
        repo: a.repo,
        relPath: a.relPath,
        artifactType: a.artifactType,
        system: a.system,
        prefix: a.prefix,
        status: a.status,
        sha256: a.sha256,
        sizeBytes: a.sizeBytes,
        mtime: a.mtime ?? isoFrom(nowMs),
        title: a.title,
      }),
    )
    .sort((x, y) => x.repo.localeCompare(y.repo) || x.relPath.localeCompare(y.relPath));

  const countsByType: Partial<Record<ArtifactType, number>> = {};
  for (const e of entries) {
    countsByType[e.artifactType] = (countsByType[e.artifactType] ?? 0) + 1;
  }

  const sources = aggregateSourceFreshness(bundle);
  return {
    schemaVersion: ARTIFACT_INDEX_SCHEMA_VERSION,
    derivedAt: isoFrom(nowMs),
    entries,
    countsByType,
    sources,
    diagnostics: diagnosticsFromFreshness(sources),
  };
}
