/**
 * `LineageSource` — emits ONE `LineageSignal` carrying the whole declarative
 * Build-Atlas lineage graph (`company/config/build-atlas-lineage.json`), loaded
 * through the ONE parser (`config/lib/build-atlas-lineage.mjs`) via the injected
 * `ctx.lineage` loader. The EXACT mirror of `PrefixRegistrySource`: the graph is
 * singular (company repo), so this source loads once, attributes the signal to
 * `company`, and only when `company` is responsible this run (a scoped refresh of
 * another repo leaves the last-good lineage in place via the scoped-merge).
 *
 * Never throws — a missing/broken graph degrades to no signal + a stale freshness
 * row, and `deriveBuildAtlas` renders no lineage rather than crashing.
 */

import { findRepoRoot, reposResponsibleFor, signalError, type CollectionContext } from "../contracts/collection-context.js";
import type { RepoFreshness, SignalBatch, WorkSignalSource } from "../contracts/WorkSignalSource.js";
import type { LineageData } from "../contracts/lineage.js";
import type { LineageSignal, Signal } from "../contracts/signals.js";
import { nowIso } from "./_shared.js";

export const LINEAGE_SOURCE_ID = "lineage";

/** The repo the canonical lineage graph lives in. */
const LINEAGE_REPO = "company";

export const lineageSource: WorkSignalSource = {
  id: LINEAGE_SOURCE_ID,
  async collect(ctx: CollectionContext): Promise<SignalBatch> {
    const collectedAt = ctx.clock.now();
    const responsible = reposResponsibleFor(ctx).some((r) => r.repo === LINEAGE_REPO);

    // A scoped refresh that doesn't touch `company` leaves the lineage alone.
    if (!responsible) {
      return { source: LINEAGE_SOURCE_ID, collectedAt, signals: [], repoFreshness: [] };
    }

    const companyRoot = findRepoRoot(ctx, LINEAGE_REPO);
    if (!companyRoot || !companyRoot.available) {
      return {
        source: LINEAGE_SOURCE_ID,
        collectedAt,
        signals: [],
        repoFreshness: [staleFreshness("company repo unavailable; lineage not refreshed")],
      };
    }

    const { data, errors } = await ctx.lineage.load();
    const degraded = errors.some((e) => e.degraded) || data === null;
    const freshness: RepoFreshness = {
      repo: LINEAGE_REPO,
      freshness: degraded ? "stale" : "live",
      lastOkAt: degraded ? null : nowIso(ctx),
      errors,
    };
    const signals: Signal[] = data ? [lineageSignalFrom(data)] : [];
    return { source: LINEAGE_SOURCE_ID, collectedAt, signals, repoFreshness: [freshness] };
  },
};

function staleFreshness(message: string): RepoFreshness {
  return {
    repo: LINEAGE_REPO,
    freshness: "stale",
    lastOkAt: null,
    errors: [signalError("repo_unavailable", message)],
  };
}

function lineageSignalFrom(data: LineageData): LineageSignal {
  return {
    kind: "lineage",
    source: LINEAGE_SOURCE_ID,
    repo: LINEAGE_REPO,
    confidence: "high",
    freshness: "live",
    errors: [],
    laneGroups: data.laneGroups,
    edges: data.edges,
  };
}
