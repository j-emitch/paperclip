/**
 * Scoped-merge (pure) — the decision-#2 mechanism that lets the git-hook
 * fast-path refresh ONE repo without erasing the others' lanes.
 *
 * A scoped collect only reads the scoped repo, so its bundle carries signals for
 * that repo alone. Before projecting, we fold in the LAST-GOOD per-(source,repo)
 * snapshots for every OTHER repo (persisted in `cos_source_versions`). The result
 * is a full bundle — fresh scoped repo + cached others — that `collectAndProject`
 * turns into a board where only the scoped lanes moved.
 *
 * Pure + DB-free so it is golden-testable; the cache layer supplies/persists the
 * `SourceVersion[]`.
 */

import type { SignalBatch, SignalBundle, RepoFreshness } from "../contracts/WorkSignalSource.js";
import type { Signal } from "../contracts/signals.js";
import type { SignalFreshness } from "../contracts/vocab.js";

/** One persisted last-good slice: a (source, repo)'s signals + freshness. */
export interface SourceVersion {
  readonly source: string;
  readonly repo: string;
  readonly signals: readonly Signal[];
  readonly freshness: SignalFreshness;
  readonly lastOkAt: string | null;
}

/** Flatten a freshly-collected bundle into per-(source, repo) slices for persistence. */
export function bundleToSourceVersions(bundle: SignalBundle): SourceVersion[] {
  const out: SourceVersion[] = [];
  for (const batch of bundle.batches) {
    // Group this batch's signals by repo.
    const byRepo = new Map<string, Signal[]>();
    for (const s of batch.signals) {
      const list = byRepo.get(s.repo) ?? [];
      list.push(s);
      byRepo.set(s.repo, list);
    }
    // Emit a slice per repo the batch reported freshness for (so a clean read of
    // a repo with zero signals still persists an empty, live slice).
    const repos = new Set<string>([...byRepo.keys(), ...batch.repoFreshness.map((r) => r.repo)]);
    for (const repo of repos) {
      const rf = batch.repoFreshness.find((r) => r.repo === repo);
      out.push({
        source: batch.source,
        repo,
        signals: byRepo.get(repo) ?? [],
        freshness: rf?.freshness ?? "live",
        lastOkAt: rf?.lastOkAt ?? null,
      });
    }
  }
  return out;
}

/**
 * Merge a scoped fresh bundle with last-good slices of the OTHER repos.
 * `scopeRepo === null` (full sweep) returns the fresh bundle unchanged. Otherwise
 * each source's batch = fresh signals/freshness for `scopeRepo` ∪ last-good for
 * every other repo, so the projection sees a complete multi-repo picture.
 */
export function mergeScopedBundle(
  fresh: SignalBundle,
  lastGood: readonly SourceVersion[],
  scopeRepo: string | null,
): SignalBundle {
  if (scopeRepo === null) return fresh;

  // Index last-good by source → (repo → slice), excluding the scoped repo
  // (the fresh bundle is authoritative for it).
  const cachedBySource = new Map<string, Map<string, SourceVersion>>();
  for (const v of lastGood) {
    if (v.repo === scopeRepo) continue;
    const m = cachedBySource.get(v.source) ?? new Map<string, SourceVersion>();
    m.set(v.repo, v);
    cachedBySource.set(v.source, m);
  }

  const sources = new Set<string>([...fresh.batches.map((b) => b.source), ...cachedBySource.keys()]);
  const batches: SignalBatch[] = [];
  for (const source of sources) {
    const freshBatch = fresh.batches.find((b) => b.source === source);
    const cached = cachedBySource.get(source) ?? new Map<string, SourceVersion>();

    // Fresh signals are already scoped to `scopeRepo` by the collector; keep
    // only those for the scoped repo to be safe, then add cached others.
    const signals: Signal[] = [
      ...(freshBatch?.signals.filter((s) => s.repo === scopeRepo) ?? []),
      ...[...cached.values()].flatMap((v) => [...v.signals]),
    ];
    const repoFreshness: RepoFreshness[] = [
      ...(freshBatch?.repoFreshness.filter((r) => r.repo === scopeRepo) ?? []),
      ...[...cached.values()].map((v) => ({ repo: v.repo, freshness: v.freshness, lastOkAt: v.lastOkAt, errors: [] })),
    ];
    batches.push({ source, collectedAt: fresh.collectedAt, signals, repoFreshness });
  }
  return { collectedAt: fresh.collectedAt, batches };
}
