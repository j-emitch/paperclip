#!/usr/bin/env node
/**
 * cos-refresh.mjs — the COS-0g thin-trigger CLI.
 *
 * A git `post-commit`/`post-merge` hook can't reach the plugin worker (a hook
 * has no `ctx`), so the hook instead invokes this standalone CLI, which POSTs
 * the plugin's `refresh-board` action over loopback. The worker then does the
 * actual scoped collect + last-good merge + derive. This file runs NO worker or
 * derive code — it is a ~zero-dependency HTTP poke, intentionally decoupled so
 * it can run from a bare git hook with no build step and no node_modules.
 *
 * Design guarantees:
 *  - NON-FATAL: it exits 0 for every outcome (host down, auth-gated, timeout,
 *    bad input) unless `--strict` is passed (tests/debugging only). A git hook
 *    must never be able to block a commit/merge.
 *  - KILL-SWITCH: `COS_HOOKS_DISABLED` (1/true/yes/on) short-circuits before any
 *    network call.
 *  - AUTH DEGRADE: the tokenless loopback POST only succeeds under the host's
 *    `local_trusted` deployment mode (which auto-elevates loopback to implicit
 *    instance-admin). Under `authenticated` mode it returns 401/403 → this CLI
 *    treats that as a graceful no-op (the 5-min `derive-board` job is the
 *    source of truth, so freshness merely degrades seconds → ≤5 min).
 *  - SELF-BOUNDED: an AbortController caps the request so a hung host can't wedge
 *    the hook even if no shell `timeout` wraps it.
 *
 * The core (`runRefresh`) is pure over an injected `fetchImpl`/`env` so it is
 * unit-testable; the CLI tail wires the real `globalThis.fetch` + argv.
 */

import { pathToFileURL } from "node:url";

export const DEFAULTS = Object.freeze({
  host: "http://127.0.0.1:3100",
  pluginKey: "lycaon.company-os",
  action: "refresh-board",
  timeoutMs: 8_000,
});

/** Outcome codes — every terminal state of a refresh attempt. */
export const OUTCOME = Object.freeze({
  OK: "ok",
  DISABLED: "disabled", // kill-switch engaged
  NO_COMPANY: "no_company", // missing required companyId — nothing to refresh
  UNAUTHENTICATED: "unauthenticated", // host in `authenticated` mode → graceful no-op
  HOST_DOWN: "host_down", // connection refused / DNS / network error
  TIMEOUT: "timeout", // request exceeded the abort deadline
  ERROR: "error", // any other non-2xx or unexpected failure
});

const TRUTHY = new Set(["1", "true", "yes", "on"]);
const isTruthy = (v) => typeof v === "string" && TRUTHY.has(v.trim().toLowerCase());

/** Outcomes that represent a successful, no-action, or expected-degraded run (exit 0 even with --strict). */
const NON_STRICT_FAILURE = new Set([OUTCOME.OK, OUTCOME.DISABLED, OUTCOME.NO_COMPANY, OUTCOME.UNAUTHENTICATED]);

/**
 * Fire one refresh. Returns a structured result; never throws.
 *
 * @param {object} opts
 * @param {string}  [opts.companyId]   Required to do anything (else NO_COMPANY).
 * @param {string|null} [opts.scopeRepo]  Repo key to scope the refresh to (null = full sweep).
 * @param {string}  [opts.host]        Host base URL.
 * @param {string}  [opts.pluginKey]   Stable plugin key (resolved by the host, not the per-install UUID).
 * @param {number}  [opts.timeoutMs]   Abort deadline.
 * @param {object}  deps
 * @param {typeof fetch} [deps.fetchImpl]
 * @param {Record<string,string|undefined>} [deps.env]
 */
export async function runRefresh(opts = {}, deps = {}) {
  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;

  // Kill-switch first — before any work or network.
  if (isTruthy(env.COS_HOOKS_DISABLED)) {
    return { outcome: OUTCOME.DISABLED, status: null, message: "COS_HOOKS_DISABLED set — no-op", data: null };
  }

  const companyId = (opts.companyId ?? env.COS_COMPANY_ID ?? "").trim();
  if (!companyId) {
    return { outcome: OUTCOME.NO_COMPANY, status: null, message: "no companyId — nothing to refresh", data: null };
  }

  const host = (opts.host ?? env.COS_HOST ?? DEFAULTS.host).replace(/\/+$/, "");
  const pluginKey = opts.pluginKey ?? env.COS_PLUGIN_KEY ?? DEFAULTS.pluginKey;
  const timeoutMs = Number(opts.timeoutMs ?? env.COS_REFRESH_TIMEOUT_MS ?? DEFAULTS.timeoutMs) || DEFAULTS.timeoutMs;
  const scopeRepoRaw = opts.scopeRepo ?? env.COS_SCOPE_REPO ?? null;
  const scopeRepo = typeof scopeRepoRaw === "string" && scopeRepoRaw.trim() !== "" ? scopeRepoRaw.trim() : null;

  const url = `${host}/api/plugins/${encodeURIComponent(pluginKey)}/actions/${DEFAULTS.action}`;
  // `companyId` rides at the top level (the host authorizes the scope from it and
  // injects it into `params`); `scopeRepo` is the worker handler's own param.
  const payload = { companyId, params: { scopeRepo } };

  if (typeof fetchImpl !== "function") {
    return { outcome: OUTCOME.ERROR, status: null, message: "no fetch implementation available", data: null };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (res.status === 401 || res.status === 403) {
      return {
        outcome: OUTCOME.UNAUTHENTICATED,
        status: res.status,
        message: "host not in local_trusted mode — hook is a no-op; the scheduled job stays source of truth",
        data: null,
      };
    }
    if (!res.ok) {
      const text = await safeText(res);
      return { outcome: OUTCOME.ERROR, status: res.status, message: `refresh failed: ${res.status} ${text}`, data: null };
    }
    const data = await safeJson(res);
    return { outcome: OUTCOME.OK, status: res.status, message: "refresh accepted", data, scopeRepo };
  } catch (err) {
    if (isAbortError(err)) {
      return { outcome: OUTCOME.TIMEOUT, status: null, message: `refresh timed out after ${timeoutMs}ms`, data: null };
    }
    // ECONNREFUSED / ENOTFOUND / network reset → the host isn't reachable.
    return { outcome: OUTCOME.HOST_DOWN, status: null, message: `host unreachable: ${String(err?.message ?? err)}`, data: null };
  } finally {
    clearTimeout(timer);
  }
}

const isAbortError = (err) => Boolean(err) && (err.name === "AbortError" || err.code === "ABORT_ERR");

async function safeText(res) {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return "";
  }
}
async function safeJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** Parse `--flag value` / `--flag=value` / `--bool` argv into a flat object. */
export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq !== -1) {
      out[a.slice(2, eq)] = a.slice(eq + 1);
    } else {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        out[key] = true;
      } else {
        out[key] = next;
        i++;
      }
    }
  }
  return out;
}

const HELP = `cos-refresh — poke the Company OS cockpit to re-derive its board (thin git-hook trigger).

Usage: cos-refresh --company <uuid> [--scope <repo>] [--host <url>] [--plugin <key>] [--timeout <ms>] [--quiet] [--strict]

Flags (env fallback in parens):
  --company <uuid>   Company to refresh        (COS_COMPANY_ID)        [required]
  --scope   <repo>   Repo key to scope to      (COS_SCOPE_REPO)        [default: full sweep]
  --host    <url>    Host base URL             (COS_HOST)              [default: ${DEFAULTS.host}]
  --plugin  <key>    Plugin key                (COS_PLUGIN_KEY)        [default: ${DEFAULTS.pluginKey}]
  --timeout <ms>     Request abort deadline    (COS_REFRESH_TIMEOUT_MS)[default: ${DEFAULTS.timeoutMs}]
  --quiet            Suppress the stdout result line
  --strict           Exit non-zero on a real failure (testing only; a git hook never sets this)

Kill-switch: COS_HOOKS_DISABLED=1 makes every invocation an immediate no-op.
Exit code is 0 for every outcome unless --strict is set and the outcome is a real failure.`;

async function main(argv) {
  const args = parseArgs(argv);
  if (args.help || args.h) {
    process.stdout.write(HELP + "\n");
    return 0;
  }
  const result = await runRefresh(
    {
      companyId: typeof args.company === "string" ? args.company : undefined,
      scopeRepo: typeof args.scope === "string" ? args.scope : undefined,
      host: typeof args.host === "string" ? args.host : undefined,
      pluginKey: typeof args.plugin === "string" ? args.plugin : undefined,
      timeoutMs: typeof args.timeout === "string" ? Number(args.timeout) : undefined,
    },
    {},
  );

  if (!args.quiet) {
    process.stdout.write(
      JSON.stringify({ outcome: result.outcome, status: result.status, scope: result.scopeRepo ?? null, message: result.message }) + "\n",
    );
  }

  const isFailure = !NON_STRICT_FAILURE.has(result.outcome);
  return args.strict && isFailure ? 1 : 0;
}

// CLI entry — only when executed directly (not when imported by a test).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      // Last-resort guard: never let an unexpected throw block a git hook.
      process.stderr.write(`cos-refresh: unexpected error: ${String(err)}\n`);
      process.exit(0);
    });
}
