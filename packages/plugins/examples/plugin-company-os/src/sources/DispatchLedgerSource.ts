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

import { reposResponsibleFor, signalError, type CollectionContext } from "../contracts/collection-context.js";
import type { SignalBatch, WorkSignalSource } from "../contracts/WorkSignalSource.js";
import type { DispatchLedgerSignal, Signal, SignalError } from "../contracts/signals.js";
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

    // No logs seam → the ledgers were UNREADABLE this run — degraded per the
    // CollectionContext contract ("a gates source treats absence as logs
    // unreadable this run"), never a silent empty (the runtime always wires
    // ctx.logs; only a pre-COS-11 fixture context lacks it).
    if (!ctx.logs) {
      ctx.logger.warn(`${DISPATCH_LEDGER_SOURCE_ID}: ctx.logs absent; ledgers not read`);
      return {
        source: DISPATCH_LEDGER_SOURCE_ID,
        collectedAt,
        signals,
        repoFreshness: [
          {
            repo: LEDGER_REPO,
            freshness: "stale",
            lastOkAt: null,
            errors: [signalError("not_found", "ctx.logs absent — dispatch ledgers unreadable this run")],
          },
        ],
      };
    }

    const provenance = {
      source: DISPATCH_LEDGER_SOURCE_ID,
      repo: LEDGER_REPO,
      confidence: "high",
      freshness: "live",
      errors: [],
    } as const;

    const errors: SignalError[] = [];
    /** Content that parses to NOTHING is a producer-schema break, not an empty
     * ledger (codex COS-11 P2) — carried as a degraded error on the signal. */
    const parseFailOf = (ledger: string, lineCount: number, rowCount: number): SignalError[] =>
      lineCount > 0 && rowCount === 0
        ? [signalError("parse_error", `${ledger} tail had lines but ZERO parseable rows — producer schema drift?`)]
        : [];

    const cannonsTail = await ctx.logs.readAllowlistedTail({ log: "cannons_runs" }, LEDGER_TAIL_BYTES);
    if (cannonsTail?.unreadable) {
      errors.push(signalError("log_read_failed", "cannons-runs ledger exists but is unreadable"));
    } else if (cannonsTail) {
      const lines = completeTailLines(cannonsTail.text, cannonsTail.truncated);
      const rows = lines.map(parseCannonsRunLine).filter((r): r is NonNullable<typeof r> => r !== null);
      const parseFail = parseFailOf("cannons-runs", lines.length, rows.length);
      signals.push({
        kind: "dispatch_ledger",
        ...provenance,
        errors: parseFail,
        freshness: parseFail.length > 0 ? "stale" : "live",
        ledger: "cannons_runs",
        truncated: cannonsTail.truncated,
        logMtime: cannonsTail.mtime,
        cannonsRuns: lastN(rows),
      } satisfies DispatchLedgerSignal);
    }

    const codexTail = await ctx.logs.readAllowlistedTail({ log: "codex_invocations" }, LEDGER_TAIL_BYTES);
    if (codexTail?.unreadable) {
      errors.push(signalError("log_read_failed", "codex-invocations ledger exists but is unreadable"));
    } else if (codexTail) {
      const lines = completeTailLines(codexTail.text, codexTail.truncated);
      const rows = lines.map(parseCodexDispatchLine).filter((r): r is NonNullable<typeof r> => r !== null);
      const parseFail = parseFailOf("codex-invocations", lines.length, rows.length);
      signals.push({
        kind: "dispatch_ledger",
        ...provenance,
        errors: parseFail,
        freshness: parseFail.length > 0 ? "stale" : "live",
        ledger: "codex_invocations",
        truncated: codexTail.truncated,
        logMtime: codexTail.mtime,
        codexRows: lastN(rows),
      } satisfies DispatchLedgerSignal);
    }

    const repoFreshness =
      errors.length > 0 ? [{ repo: LEDGER_REPO, freshness: "stale" as const, lastOkAt: null, errors }] : [];
    return { source: DISPATCH_LEDGER_SOURCE_ID, collectedAt, signals, repoFreshness };
  },
};
