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
import {
  acquireDeriveLock,
  assertNamespace,
  ensureBoardRow,
  recordRun,
  releaseDeriveLock,
  replaceSourceVersions,
  loadSourceVersions,
  writeProjections,
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
    const ctx = await deps.makeContext(scopeRepo);
    const { bundle, failedSources } = await collect(ctx);
    if (failedSources.length > 0) logger.warn(`sources threw during collect`, { companyId, failedSources });

    const merged =
      scopeRepo === null ? bundle : mergeScopedBundle(bundle, await loadSourceVersions(db, companyId), scopeRepo);

    const projections = collectAndProject(merged, deps.now());
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
