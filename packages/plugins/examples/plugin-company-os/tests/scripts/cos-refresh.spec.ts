/**
 * `cos-refresh.mjs` — the thin-trigger CLI core. Drives `runRefresh` with an
 * injected `fetch` + `env` to exercise every terminal outcome: success, the
 * kill-switch, missing input, auth-degrade (401/403), host-down, timeout, and
 * non-2xx — plus the exact POST URL + body the worker action expects, and the
 * argv parser. The `.mjs` stays untyped/zero-dep for git-hook use; its typed
 * contract comes from the paired `cos-refresh.d.mts` sidecar.
 */

import { describe, expect, it, vi } from "vitest";
import { runRefresh, OUTCOME, parseArgs, DEFAULTS, type RefreshResult } from "../../scripts/cos-refresh.mjs";

const COMPANY = "64ce294e-5e04-4cca-8f10-71c9732258b2";

const jsonResponse = (status: number, body: unknown = { data: { ok: true } }): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as Response;

/**
 * Wrap a narrowly-typed mock so it is assignable to the `typeof fetch` param
 * while keeping its `.mock` handle (sanctioned typed test cast — the mock's
 * arg shape is intentionally narrower than the DOM `fetch` overloads).
 */
const asFetch = <T extends (...a: never[]) => unknown>(fn: T): typeof fetch & T => fn as unknown as typeof fetch & T;

/** A typed fetch mock so `.mock.calls[0]` resolves as `[url, init]`. */
const fetchReturning = (status: number, body?: unknown) =>
  asFetch(vi.fn((_url: string, _init: RequestInit) => Promise.resolve(jsonResponse(status, body))));

describe("runRefresh", () => {
  it("POSTs the action with companyId top-level + scopeRepo in params, returns ok", async () => {
    const fetchImpl = fetchReturning(200, { data: { skipped: false } });
    const res: RefreshResult = await runRefresh(
      { companyId: COMPANY, scopeRepo: "juice-bar", host: "http://127.0.0.1:3100" },
      { fetchImpl, env: {} },
    );

    expect(res.outcome).toBe(OUTCOME.OK);
    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:3100/api/plugins/lycaon.company-os/actions/refresh-board");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ companyId: COMPANY, params: { scopeRepo: "juice-bar" } });
  });

  it("sends scopeRepo:null for a full sweep when no scope is given", async () => {
    const fetchImpl = fetchReturning(200);
    await runRefresh({ companyId: COMPANY }, { fetchImpl, env: {} });
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1].body)).params.scopeRepo).toBeNull();
  });

  it("strips a trailing slash from the host", async () => {
    const fetchImpl = fetchReturning(200);
    await runRefresh({ companyId: COMPANY, host: "http://127.0.0.1:3100/" }, { fetchImpl, env: {} });
    expect(fetchImpl.mock.calls[0][0]).toBe("http://127.0.0.1:3100/api/plugins/lycaon.company-os/actions/refresh-board");
  });

  it("kill-switch: COS_HOOKS_DISABLED short-circuits before any fetch", async () => {
    const fetchImpl = fetchReturning(200);
    for (const v of ["1", "true", "yes", "on", "ON"]) {
      const res: RefreshResult = await runRefresh({ companyId: COMPANY }, { fetchImpl, env: { COS_HOOKS_DISABLED: v } });
      expect(res.outcome).toBe(OUTCOME.DISABLED);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("missing companyId → NO_COMPANY, no fetch", async () => {
    const fetchImpl = fetchReturning(200);
    const res: RefreshResult = await runRefresh({}, { fetchImpl, env: {} });
    expect(res.outcome).toBe(OUTCOME.NO_COMPANY);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("falls back to COS_COMPANY_ID / COS_SCOPE_REPO from env", async () => {
    const fetchImpl = fetchReturning(200);
    await runRefresh({}, { fetchImpl, env: { COS_COMPANY_ID: COMPANY, COS_SCOPE_REPO: "company" } });
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1].body))).toEqual({
      companyId: COMPANY,
      params: { scopeRepo: "company" },
    });
  });

  it("401/403 → graceful UNAUTHENTICATED no-op (authenticated-mode host)", async () => {
    for (const status of [401, 403]) {
      const fetchImpl = fetchReturning(status, { error: "unauthorized" });
      const res: RefreshResult = await runRefresh({ companyId: COMPANY }, { fetchImpl, env: {} });
      expect(res.outcome).toBe(OUTCOME.UNAUTHENTICATED);
      expect(res.status).toBe(status);
    }
  });

  it("other non-2xx → ERROR with the status", async () => {
    const fetchImpl = fetchReturning(500, { error: "boom" });
    const res: RefreshResult = await runRefresh({ companyId: COMPANY }, { fetchImpl, env: {} });
    expect(res.outcome).toBe(OUTCOME.ERROR);
    expect(res.status).toBe(500);
  });

  it("connection error → HOST_DOWN (graceful)", async () => {
    const fetchImpl = asFetch(
      vi.fn((_url: string, _init: RequestInit): Promise<Response> => {
        throw Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:3100"), { code: "ECONNREFUSED" });
      }),
    );
    const res: RefreshResult = await runRefresh({ companyId: COMPANY }, { fetchImpl, env: {} });
    expect(res.outcome).toBe(OUTCOME.HOST_DOWN);
  });

  it("a hung host trips the AbortController → TIMEOUT", async () => {
    const hangingFetch = asFetch(
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener("abort", () =>
              reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
            );
          }),
      ),
    );
    const res: RefreshResult = await runRefresh({ companyId: COMPANY, timeoutMs: 10 }, { fetchImpl: hangingFetch, env: {} });
    expect(res.outcome).toBe(OUTCOME.TIMEOUT);
  });

  it("returns ERROR (never throws) when no fetch implementation is available", async () => {
    const original = globalThis.fetch;
    vi.stubGlobal("fetch", undefined);
    try {
      const res: RefreshResult = await runRefresh({ companyId: COMPANY }, { env: {} });
      expect(res.outcome).toBe(OUTCOME.ERROR);
    } finally {
      vi.stubGlobal("fetch", original);
    }
  });
});

describe("parseArgs", () => {
  it("parses --flag value, --flag=value, and bare --bool", () => {
    expect(parseArgs(["--company", "abc", "--scope=juice-bar", "--quiet"])).toEqual({
      company: "abc",
      scope: "juice-bar",
      quiet: true,
    });
  });

  it("treats a flag followed by another flag as boolean", () => {
    expect(parseArgs(["--strict", "--company", "x"])).toEqual({ strict: true, company: "x" });
  });

  it("exposes sane defaults", () => {
    expect(DEFAULTS.pluginKey).toBe("lycaon.company-os");
    expect(DEFAULTS.action).toBe("refresh-board");
  });
});
