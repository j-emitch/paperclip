/**
 * `deriveForCompany` — the per-company derive orchestration the job + the
 * refresh-board action both call. Ties the pieces together under the atomic
 * cache lock: collect (scoped) → merge last-good others → project → validate +
 * write → persist source slices → record the run. A second concurrent derive for
 * the same company no-ops (lock not acquired); a failure is recorded and the lock
 * always released.
 *
 * The impure boundary (clock, the CollectionContext factory, the db) is injected,
 * so the orchestration is deterministic to reason about and the pure pieces
 * (collect/projections/merge) stay pure.
 */

import { collect } from "./collect.js";
import { collectAndProject } from "./collect-and-project.js";
import type { CollectionContext, SignalLogger } from "./contracts/collection-context.js";
import type { ProjectTaxonomyV1 } from "./contracts/projects.js";
import {
  acquireDeriveLock,
  assertNamespace,
  ensureBoardRow,
  recordRun,
  releaseDeriveLock,
  replaceSourceVersions,
  loadSourceVersions,
  writeProjections,
  readGitState,
  readGatesState,
  type DbClient,
} from "./db/cache.js";
import { bundleToSourceVersions, mergeScopedBundle } from "./db/scoped-merge.js";

export type DeriveTrigger = "schedule" | "hook" | "manual";

export interface DeriveDeps {
  readonly db: DbClient;
  /** Build a CollectionContext for the given scope (null = full sweep). */
  readonly makeContext: (scopeRepo: string | null) => Promise<CollectionContext>;
  /** Wall clock (epoch ms) — injected so the derive's `derivedAt` is controllable. */
  readonly now: () => number;
  readonly logger: SignalLogger;
  /**
   * Resolve the project taxonomy FRESH from config (raw repoRoots + projects) —
   * a worker-provided thunk (PF-5/v6). Keeps `derive.ts` config-read-free: it
   * never touches `ctx.config`, just awaits this. Resolving from raw repoRoots
   * (not `ctx.repos`, already basename-collapsed) preserves the dup-basename
   * diagnostic (PF-7).
   */
  readonly resolveTaxonomy: () => Promise<ProjectTaxonomyV1>;
  /** Lock lease; a derive that crashes mid-flight is reclaimable after this. */
  readonly leaseMs?: number;
}

export interface DeriveResult {
  readonly ok: boolean;
  /** True when the lock was held by another derive — this one no-oped. */
  readonly skipped: boolean;
  readonly error: string | null;
}

const DEFAULT_LEASE_MS = 120_000;

export async function deriveForCompany(
  deps: DeriveDeps,
  companyId: string,
  trigger: DeriveTrigger,
  scopeRepo: string | null,
  owner: string,
): Promise<DeriveResult> {
  const { db, logger } = deps;
  assertNamespace(db);
  await ensureBoardRow(db, companyId);

  const nowMs = deps.now();
  const acquired = await acquireDeriveLock(db, companyId, owner, deps.leaseMs ?? DEFAULT_LEASE_MS, nowMs);
  if (!acquired) {
    logger.info(`derive skipped for ${companyId} — lock held`, { trigger, scopeRepo });
    return { ok: true, skipped: true, error: null };
  }

  try {
    const baseCtx = await deps.makeContext(scopeRepo);
    // Thread the PREVIOUS payload's rollup cache to the stateless sources
    // (COS-11.gh-fields rate contract): read-only, absent on first derive.
    const priorGitState = await readGitState(db, companyId).catch(() => null);
    const ctx: CollectionContext =
      priorGitState && Object.keys(priorGitState.prRollups).length > 0
        ? { ...baseCtx, prior: { prRollups: priorGitState.prRollups } }
        : baseCtx;
    const { bundle, failedSources } = await collect(ctx);
    if (failedSources.length > 0) logger.warn(`sources threw during collect`, { companyId, failedSources });

    const merged =
      scopeRepo === null ? bundle : mergeScopedBundle(bundle, await loadSourceVersions(db, companyId), scopeRepo);

    // Resolve the taxonomy fresh from config (the worker thunk), once, then thread
    // it as the project-grouping lens to the three COS-1 projections (PF-5).
    const taxonomy = await deps.resolveTaxonomy();
    // Prior gates state feeds the row-8 last-good merge (COS-11); null on first
    // derive. A READ error is warned, never silent — with no prior, row-8 cannot
    // carry a missing target this derive (codex COS-11 P1 observability note).
    const priorGates = await readGatesState(db, companyId).catch((err) => {
      logger.warn(`prior gates-state read failed for ${companyId} — row-8 carry unavailable this derive`, { error: String(err) });
      return null;
    });
    const projections = collectAndProject(merged, deps.now(), taxonomy, priorGates);
    await writeProjections(db, companyId, projections, owner);
    // Persist the per-source last-good slices from the MERGED bundle so a future
    // scoped refresh of a different repo still has every other repo's last-good.
    // REPLACE semantics: a full sweep purges dropped repos; a scoped refresh only
    // replaces its own repo's slices.
    await replaceSourceVersions(db, companyId, scopeRepo, bundleToSourceVersions(merged));
    await recordRun(db, companyId, {
      trigger,
      scopeRepo,
      ok: true,
      diagnostics: projections.board.diagnostics,
      error: null,
    });
    return { ok: true, skipped: false, error: null };
  } catch (err) {
    const error = String(err);
    logger.error(`derive failed for ${companyId}`, { trigger, scopeRepo, error });
    await recordRun(db, companyId, { trigger, scopeRepo, ok: false, diagnostics: [], error }).catch(() => {});
    return { ok: false, skipped: false, error };
  } finally {
    await releaseDeriveLock(db, companyId, owner).catch(() => {});
  }
}
