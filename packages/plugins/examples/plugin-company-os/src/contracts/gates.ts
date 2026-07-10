/**
 * COS-11 gates constants + line parsers — the ZOD-FREE half of the Gates &
 * Pipeline contract (the persisted `GatesStateV1` lives in `gates-state.ts`).
 * Sources import from HERE so the source layer stays zod-free; every path/glob
 * a gates source reads is a named constant in this file (spec §7: "contract-
 * constant paths" — no path literals inside a source).
 */

// ---------------------------------------------------------------------------
// Bounds (spec §7 DispatchLedgerSource bounded-read contract + §4 tick budget)
// ---------------------------------------------------------------------------

/** Tail-window bound per allowlisted log read — logs grow forever + retention-prune. */
export const LEDGER_TAIL_BYTES = 524_288 as const; // 512KB
/** Max parsed rows kept per ledger (the LAST N). */
export const LEDGER_MAX_ROWS = 2_000 as const;
/** Combined budget for the four gates sources per derive tick; exhaustion → diagnostic. */
export const GATES_BUDGET_MS = 4_000 as const;

/**
 * The four gates source ids — the batches `deriveGatesState` reads freshness
 * from. Kept in lockstep with each source's exported `*_SOURCE_ID` (drift-
 * guarded in the deriveGatesState spec).
 */
export const GATES_SOURCE_IDS = ["hooks", "migration_audit", "dispatch_ledger", "protection"] as const;

// ---------------------------------------------------------------------------
// Contract-constant read paths (repo-relative; the repo key is named beside each)
// ---------------------------------------------------------------------------

/** The repo whose reports/ hold the migration-audit JSON + apply receipts. */
export const MIGRATION_AUDIT_REPO = "juice-bar" as const;
/** Drift-audit JSON files (newest wins), e.g. reports/migrations/audit-staging-2026-06-30.json. */
export const MIGRATION_AUDIT_GLOB = "reports/migrations/audit-*.json" as const;
/** Prod/staging apply receipts (newest mtime wins). */
export const MIGRATION_APPLY_GLOB = "reports/migration-apply/*.md" as const;

/** The repo that owns branch-protection-as-code + the canonical hooks. */
export const GATES_COMPANY_REPO = "company" as const;
/** Managed desired-state protection JSONs (one per product repo) + the manifest. */
export const PROTECTION_GLOB = "config/branch-protection/*.json" as const;
export const PROTECTION_MANIFEST = "config/branch-protection/repos.json" as const;
/** Canonical hooks every product repo's .githooks/* is byte-compared against. */
export const CANONICAL_HOOKS_GLOB = ".githooks/*" as const;
export const REPO_HOOKS_GLOB = ".githooks/*" as const;
/** The script whose GATE_SUITES= line names the gate test suites. */
export const HOOK_TESTS_REL = "scripts/run-hook-tests.sh" as const;

// ---------------------------------------------------------------------------
// Line parsers (pure — shared by DispatchLedgerSource + its tests)
// ---------------------------------------------------------------------------

/** One cannons provenance line: `<run_id> <sha8> <verdict> <repo> <ISO> [reportPath]`. */
export interface CannonsRunRow {
  readonly runId: string;
  readonly sha8: string;
  readonly verdict: string;
  readonly repo: string;
  readonly at: string;
  /** Optional 6th field (newer lines carry the report relPath). */
  readonly reportPath: string | null;
}

/** Parse one provenance line; null on a malformed/partial line (dropped, never a throw). */
export function parseCannonsRunLine(line: string): CannonsRunRow | null {
  const parts = line.trim().split(/\s+/);
  if (parts.length < 5) return null;
  const [runId, sha8, verdict, repo, at] = parts;
  if (!/^[0-9a-f]{8}$/i.test(sha8)) return null;
  if (Number.isNaN(Date.parse(at))) return null;
  return { runId, sha8, verdict, repo, at, reportPath: parts[5] ?? null };
}

/** One codex dispatch row (codex-invocations.ndjson) — NO sha field exists (Fable minor 10). */
export interface CodexDispatchRow {
  readonly t: string;
  readonly consumer: string;
  readonly repo: string;
  readonly success: boolean;
  readonly model: string;
}

/** Parse one ndjson row; null on malformed/partial (dropped, never a throw). */
export function parseCodexDispatchLine(line: string): CodexDispatchRow | null {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.t !== "string" || typeof o.consumer !== "string") return null;
  // success is load-bearing (lane pass/fail) — a row without a boolean is
  // malformed, not "false" (coercion would render a fake failed lane).
  if (typeof o.success !== "boolean") return null;
  return {
    t: o.t,
    consumer: o.consumer,
    repo: typeof o.repo === "string" ? o.repo : "",
    success: o.success,
    model: typeof o.model === "string" ? o.model : "",
  };
}

/**
 * Split a bounded tail into COMPLETE lines: when the read was truncated the
 * first line may be partial and is DROPPED (spec §4.1 row 7).
 */
export function completeTailLines(text: string, truncated: boolean): string[] {
  let t = text;
  if (truncated) {
    // Drop ONLY the initial partial segment (up to the first newline). When the
    // cut lands exactly ON a newline the first segment is empty and the first
    // FULL row survives — filtering empties before slicing used to eat it.
    const nl = t.indexOf("\n");
    t = nl === -1 ? "" : t.slice(nl + 1);
  }
  return t.split("\n").filter((l) => l.trim() !== "");
}

/** Parse the GATE_SUITES= assignment out of run-hook-tests.sh (suite names, space-separated). */
export function parseGateSuites(scriptText: string): string[] {
  const m = scriptText.match(/^GATE_SUITES="\$\{[A-Z_]+-([^}"]*)\}"/m) ?? scriptText.match(/^GATE_SUITES="([^"]*)"/m);
  if (!m) return [];
  return m[1].split(/\s+/).filter(Boolean);
}
