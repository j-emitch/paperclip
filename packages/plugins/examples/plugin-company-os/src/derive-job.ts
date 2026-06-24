/**
 * `runDeriveBoardJob` — the scheduled `derive-board` tick, extracted from the
 * worker so the jitter + per-company fan-out + failure-isolation are unit
 * testable without the SDK.
 *
 * Why jitter (Opus D2 — no host primitive): the job runs on a five-minute cron
 * schedule, so every instance fires on the exact boundary. A git-hook
 * `refresh-board` that lands on the same boundary then races the job for the
 * per-company derive lock — the loser just no-ops (the lock is correct), but
 * the churn is wasteful. A small self-implemented startup jitter spreads the
 * tick across a few seconds so the common case is contention-free. The lock is
 * still the correctness backstop; jitter is only an optimization, so the delay
 * is bounded well under the cron period and the clock/RNG are injected.
 *
 * Failure isolation: one company's derive throwing (or returning `ok:false`)
 * must never abort the remaining companies — each is tallied and the loop
 * continues. The summary is returned for the worker to log and for tests to
 * assert against.
 */

import type { DeriveResult } from "./derive.js";
import type { SignalLogger } from "./contracts/collection-context.js";

/** Default startup jitter ceiling — 5s, two orders of magnitude under the 5-min cron period. */
export const DEFAULT_JITTER_MAX_MS = 5_000;

export interface DeriveJobDeps {
  /** Enumerate the companies to derive (worker passes `ctx.companies.list`). */
  readonly listCompanies: () => Promise<readonly { readonly id: string }[]>;
  /** Derive one company under the cache lock (worker passes a `deriveForCompany` closure). */
  readonly derive: (companyId: string) => Promise<DeriveResult>;
  /** Sleep helper (injected so the jitter delay is deterministic in tests). */
  readonly sleep: (ms: number) => Promise<void>;
  /** Uniform RNG in [0, 1) (injected; `Math.random` in production). */
  readonly rng: () => number;
  readonly logger: SignalLogger;
}

export interface DeriveJobOptions {
  /** Upper bound (exclusive) on the startup jitter delay. Default {@link DEFAULT_JITTER_MAX_MS}. */
  readonly jitterMaxMs?: number;
}

export interface DeriveJobSummary {
  readonly companies: number;
  /** Derives that ran to completion (`ok && !skipped`). */
  readonly derived: number;
  /** Derives that no-oped because the lock was held by a concurrent derive. */
  readonly skipped: number;
  /** Derives that threw or returned `ok:false`. */
  readonly failed: number;
  /** The jitter delay actually applied this tick. */
  readonly jitterMs: number;
}

/** Compute a bounded startup jitter delay in `[0, max)` from an injected RNG. */
export function jitterDelayMs(maxMs: number, rng: () => number): number {
  const ceiling = Number.isFinite(maxMs) && maxMs > 0 ? maxMs : 0;
  if (ceiling === 0) return 0;
  const r = rng();
  const clamped = Number.isFinite(r) ? Math.min(Math.max(r, 0), 0.999_999) : 0;
  return Math.floor(clamped * ceiling);
}

/**
 * Run one scheduled derive tick: jitter → enumerate companies → derive each
 * (failure-isolated) → return a tally. Never throws on a per-company failure;
 * it only propagates if {@link DeriveJobDeps.listCompanies} itself rejects.
 */
export async function runDeriveBoardJob(
  deps: DeriveJobDeps,
  opts: DeriveJobOptions = {},
): Promise<DeriveJobSummary> {
  const { listCompanies, derive, sleep, rng, logger } = deps;

  const jitterMs = jitterDelayMs(opts.jitterMaxMs ?? DEFAULT_JITTER_MAX_MS, rng);
  if (jitterMs > 0) await sleep(jitterMs);

  const companies = await listCompanies();
  logger.info(
    `derive-board: deriving ${companies.length} compan${companies.length === 1 ? "y" : "ies"} (jitter ${jitterMs}ms)`,
  );

  let derived = 0;
  let skipped = 0;
  let failed = 0;

  for (const company of companies) {
    try {
      const result = await derive(company.id);
      if (!result.ok) {
        failed += 1;
        logger.warn(`derive-board: derive failed for ${company.id}`, { error: result.error });
      } else if (result.skipped) {
        skipped += 1;
      } else {
        derived += 1;
      }
    } catch (err) {
      // A thrown derive must not abort the remaining companies.
      failed += 1;
      logger.error(`derive-board: derive threw for ${company.id}`, { error: String(err) });
    }
  }

  const summary: DeriveJobSummary = { companies: companies.length, derived, skipped, failed, jitterMs };
  logger.info(`derive-board: tick complete`, { ...summary });
  return summary;
}
