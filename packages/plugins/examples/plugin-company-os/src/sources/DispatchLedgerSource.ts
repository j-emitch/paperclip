/**
 * `DispatchLedgerSource` (COS-11) — bounded tail-reads of the two home-dir
 * provenance ledgers via the §3.3b allowlisted reader (the ONLY sanctioned
 * out-of-repo reads): `cannons-runs.log` (pre-push gate receipts) and
 * `codex-invocations.ndjson` (review-lane dispatches). Emits ONE
 * `DispatchLedgerSignal` per ledger that exists; ledger absence is NORMAL
 * (fresh machine) → no signal, no error. Attributed to `company` (the ledgers
 * are machine-global; company is the governance repo) and collected only when
 * `company` is responsible — a scoped refresh elsewhere keeps last-good.
 *
 * Truncation is an EXPECTED state (`truncated: true` renders "history
 * truncated"); the first possibly-partial line is dropped (spec §4.1 row 7).
 * Deliberately NO mtime-watermark caching via `ctx.prior` — a 512KB read per
 * derive is trivial (§10.8 deviation note).
 */

import { reposResponsibleFor, type CollectionContext } from "../contracts/collection-context.js";
import type { SignalBatch, WorkSignalSource } from "../contracts/WorkSignalSource.js";
import type { DispatchLedgerSignal, Signal } from "../contracts/signals.js";
import {
  LEDGER_MAX_ROWS,
  LEDGER_TAIL_BYTES,
  completeTailLines,
  parseCannonsRunLine,
  parseCodexDispatchLine,
} from "../contracts/gates.js";

export const DISPATCH_LEDGER_SOURCE_ID = "dispatch_ledger";

/** The repo the ledger signals are attributed to (machine-global governance data). */
const LEDGER_REPO = "company";

function lastN<T>(rows: readonly T[]): readonly T[] {
  return rows.length > LEDGER_MAX_ROWS ? rows.slice(rows.length - LEDGER_MAX_ROWS) : rows;
}

export const dispatchLedgerSource: WorkSignalSource = {
  id: DISPATCH_LEDGER_SOURCE_ID,
  async collect(ctx: CollectionContext): Promise<SignalBatch> {
    const collectedAt = ctx.clock.now();
    if (!reposResponsibleFor(ctx).some((r) => r.repo === LEDGER_REPO)) {
      return { source: DISPATCH_LEDGER_SOURCE_ID, collectedAt, signals: [], repoFreshness: [] };
    }
    const signals: Signal[] = [];

    // No logs seam (pre-COS-11 fixture context) → nothing to read this run. The
    // runtime always wires ctx.logs; absence is a fixture-only state, so this is
    // a warn + empty, not a degraded board row.
    if (!ctx.logs) {
      ctx.logger.warn(`${DISPATCH_LEDGER_SOURCE_ID}: ctx.logs absent; ledgers not read`);
      return { source: DISPATCH_LEDGER_SOURCE_ID, collectedAt, signals, repoFreshness: [] };
    }

    const provenance = {
      source: DISPATCH_LEDGER_SOURCE_ID,
      repo: LEDGER_REPO,
      confidence: "high",
      freshness: "live",
      errors: [],
    } as const;

    const cannonsTail = await ctx.logs.readAllowlistedTail({ log: "cannons_runs" }, LEDGER_TAIL_BYTES);
    if (cannonsTail) {
      const rows = completeTailLines(cannonsTail.text, cannonsTail.truncated)
        .map(parseCannonsRunLine)
        .filter((r): r is NonNullable<typeof r> => r !== null);
      const signal: DispatchLedgerSignal = {
        kind: "dispatch_ledger",
        ...provenance,
        ledger: "cannons_runs",
        truncated: cannonsTail.truncated,
        logMtime: cannonsTail.mtime,
        cannonsRuns: lastN(rows),
      };
      signals.push(signal);
    }

    const codexTail = await ctx.logs.readAllowlistedTail({ log: "codex_invocations" }, LEDGER_TAIL_BYTES);
    if (codexTail) {
      const rows = completeTailLines(codexTail.text, codexTail.truncated)
        .map(parseCodexDispatchLine)
        .filter((r): r is NonNullable<typeof r> => r !== null);
      const signal: DispatchLedgerSignal = {
        kind: "dispatch_ledger",
        ...provenance,
        ledger: "codex_invocations",
        truncated: codexTail.truncated,
        logMtime: codexTail.mtime,
        codexRows: lastN(rows),
      };
      signals.push(signal);
    }

    return { source: DISPATCH_LEDGER_SOURCE_ID, collectedAt, signals, repoFreshness: [] };
  },
};
