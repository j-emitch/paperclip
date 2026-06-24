/**
 * Hand-written type declaration for the plain-ESM `cos-refresh.mjs` CLI. The
 * script itself stays untyped + zero-dependency so it can run from a bare git
 * hook with no build step; this sidecar gives the tests (and any TS importer) a
 * typed view of its public contract. TypeScript pairs it automatically by
 * basename (`cos-refresh.mjs` ↔ `cos-refresh.d.mts`).
 */

export interface RefreshDefaults {
  readonly host: string;
  readonly pluginKey: string;
  readonly action: string;
  readonly timeoutMs: number;
}

export const DEFAULTS: RefreshDefaults;

export type RefreshOutcome =
  | "ok"
  | "disabled"
  | "no_company"
  | "unauthenticated"
  | "host_down"
  | "timeout"
  | "error";

export const OUTCOME: {
  readonly OK: "ok";
  readonly DISABLED: "disabled";
  readonly NO_COMPANY: "no_company";
  readonly UNAUTHENTICATED: "unauthenticated";
  readonly HOST_DOWN: "host_down";
  readonly TIMEOUT: "timeout";
  readonly ERROR: "error";
};

export interface RefreshOptions {
  companyId?: string;
  scopeRepo?: string | null;
  host?: string;
  pluginKey?: string;
  timeoutMs?: number;
}

export interface RefreshDeps {
  fetchImpl?: typeof fetch | undefined;
  env?: Record<string, string | undefined>;
}

export interface RefreshResult {
  outcome: RefreshOutcome;
  status: number | null;
  message: string;
  data: unknown;
  scopeRepo?: string | null;
}

export function runRefresh(opts?: RefreshOptions, deps?: RefreshDeps): Promise<RefreshResult>;

export function parseArgs(argv: string[]): Record<string, string | boolean>;
