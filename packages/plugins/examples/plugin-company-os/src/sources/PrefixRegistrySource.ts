/**
 * `PrefixRegistrySource` — emits a `TaxonomySignal` per row of the canonical
 * prefix registry (`company/config/prefix-registry.json`), loaded through the
 * ONE parser (`config/lib/prefix-registry.mjs`) via the injected
 * `RegistryLoader`. The board, the advisory, and the future COS-2 classifier all
 * resolve prefixes through this same registry — "one taxonomy, no drift".
 *
 * The registry is singular (it lives in the company repo), so this source does
 * NOT iterate every repo: it loads once, attributing the signals to `company`,
 * and only when `company` is responsible this run (a scoped refresh of another
 * repo leaves the last-good taxonomy in place via the COS-0d scoped-merge).
 */

import {
  findRepoRoot,
  reposResponsibleFor,
  signalError,
  type CollectionContext,
} from "../contracts/collection-context.js";
import type { SignalBatch, RepoFreshness, WorkSignalSource } from "../contracts/WorkSignalSource.js";
import type { Signal, TaxonomySignal } from "../contracts/signals.js";
import type { RegistryEntry } from "../contracts/registry.js";
import { nowIso } from "./_shared.js";

export const PREFIX_REGISTRY_SOURCE_ID = "prefix-registry";

/** The repo the canonical registry lives in. */
const REGISTRY_REPO = "company";

export const prefixRegistrySource: WorkSignalSource = {
  id: PREFIX_REGISTRY_SOURCE_ID,
  async collect(ctx: CollectionContext): Promise<SignalBatch> {
    const collectedAt = ctx.clock.now();
    const responsible = reposResponsibleFor(ctx).some((r) => r.repo === REGISTRY_REPO);

    // A scoped refresh that doesn't touch `company` leaves the taxonomy alone.
    if (!responsible) {
      return { source: PREFIX_REGISTRY_SOURCE_ID, collectedAt, signals: [], repoFreshness: [] };
    }

    const companyRoot = findRepoRoot(ctx, REGISTRY_REPO);
    if (!companyRoot || !companyRoot.available) {
      return {
        source: PREFIX_REGISTRY_SOURCE_ID,
        collectedAt,
        signals: [],
        repoFreshness: [staleFreshness("company repo unavailable; taxonomy not refreshed")],
      };
    }

    const { entries, errors } = await ctx.registry.load();
    const degraded = errors.some((e) => e.degraded) || entries.length === 0;
    const freshness: RepoFreshness = {
      repo: REGISTRY_REPO,
      freshness: degraded ? "stale" : "live",
      lastOkAt: degraded ? null : nowIso(ctx),
      errors,
    };
    const signals: Signal[] = entries.map((e) => taxonomySignal(e));
    return { source: PREFIX_REGISTRY_SOURCE_ID, collectedAt, signals, repoFreshness: [freshness] };
  },
};

function staleFreshness(message: string): RepoFreshness {
  return {
    repo: REGISTRY_REPO,
    freshness: "stale",
    lastOkAt: null,
    errors: [signalError("repo_unavailable", message)],
  };
}

function taxonomySignal(e: RegistryEntry): TaxonomySignal {
  return {
    kind: "taxonomy",
    source: PREFIX_REGISTRY_SOURCE_ID,
    repo: REGISTRY_REPO,
    confidence: "high",
    freshness: "live",
    errors: [],
    prefix: e.prefix,
    family: e.family,
    l1System: e.l1_system,
    l2Subsystem: e.l2_subsystem,
    isGeneric: e.is_generic,
  };
}
