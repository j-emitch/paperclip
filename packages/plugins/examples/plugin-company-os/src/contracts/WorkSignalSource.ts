/**
 * `WorkSignalSource` — the single narrow seam between the host/repo world and
 * the pure projections (spec §5.1).
 *
 * Every reader of git / gh / fs / AGENTS / the registry implements this one
 * interface; the projections consume only the typed `SignalBatch` it returns.
 * The board never imports `gh`, cannons paths, or AGENTS formatting — it reads
 * a batch. Sources are independently unit-testable against golden fixtures, and
 * COS-1/COS-2 add NEW sources (see `extensions.ts`) without touching existing
 * ones.
 */

import type { CollectionContext } from "./collection-context.js";
import type { Signal, SignalError } from "./signals.js";
import type { SignalFreshness } from "./vocab.js";

export interface WorkSignalSource {
  /** Stable id, stamped onto every emitted signal's `source` and `SignalBatch.source`. */
  readonly id: string;
  /**
   * Collect typed signals for the in-scope repos.
   *
   * Contract (load-bearing — the projections assume it): a source MUST NOT throw
   * on a read failure. A failed/unauth/timed-out read becomes a degraded signal
   * + a `RepoFreshness` entry marked `stale`, so one flaky source never blanks
   * the board. Only a programming fault should reject.
   */
  collect(ctx: CollectionContext): Promise<SignalBatch>;
}

/** Per-repo freshness this source produced — folds into the projection's `SourceFreshness`. */
export interface RepoFreshness {
  readonly repo: string;
  readonly freshness: SignalFreshness;
  /** ISO-8601 of the last successful read for this (source, repo); null = never succeeded. */
  readonly lastOkAt: string | null;
  /** Non-fatal errors hit for this repo on this collect. */
  readonly errors: readonly SignalError[];
}

/** What a source returns: its signals plus the per-repo freshness behind them. */
export interface SignalBatch {
  /** The source id that produced the batch (=== the producing `WorkSignalSource.id`). */
  readonly source: string;
  /** Wall-clock the batch was produced (epoch ms, from `ctx.clock.now()`). */
  readonly collectedAt: number;
  readonly signals: readonly Signal[];
  /** Freshness for each repo this source was responsible for this run. */
  readonly repoFreshness: readonly RepoFreshness[];
}

/** The combined input the pure projections fold over — one batch per source. */
export interface SignalBundle {
  /** Wall-clock the bundle was assembled (epoch ms). */
  readonly collectedAt: number;
  readonly batches: readonly SignalBatch[];
}

/** Flatten a bundle's signals (order-preserving) — a convenience for the projections. */
export function allSignals(bundle: SignalBundle): readonly Signal[] {
  return bundle.batches.flatMap((b) => b.signals);
}
