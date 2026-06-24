/**
 * `runDeriveBoardJob` — the scheduled tick. Asserts the bounded startup jitter,
 * per-company fan-out, failure isolation (one company throwing/failing never
 * aborts the rest), and the returned tally. Clock/RNG/sleep are injected so the
 * test is deterministic.
 */

import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_JITTER_MAX_MS,
  jitterDelayMs,
  runDeriveBoardJob,
  type DeriveJobDeps,
} from "../src/derive-job.js";
import type { DeriveResult } from "../src/derive.js";

const ok = (skipped = false): DeriveResult => ({ ok: true, skipped, error: null });
const fail = (error = "boom"): DeriveResult => ({ ok: false, skipped: false, error });

const silentLogger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });

function makeDeps(over: Partial<DeriveJobDeps> = {}): DeriveJobDeps {
  return {
    listCompanies: async () => [{ id: "c1" }, { id: "c2" }],
    derive: async () => ok(),
    sleep: async () => {},
    rng: () => 0,
    logger: silentLogger(),
    ...over,
  };
}

describe("jitterDelayMs", () => {
  it("maps the RNG into [0, max)", () => {
    expect(jitterDelayMs(5000, () => 0)).toBe(0);
    expect(jitterDelayMs(5000, () => 0.5)).toBe(2500);
    // Never reaches the ceiling (clamped just below 1).
    expect(jitterDelayMs(5000, () => 1)).toBeLessThan(5000);
    expect(jitterDelayMs(5000, () => 0.999999)).toBeLessThan(5000);
  });

  it("returns 0 for a non-positive or non-finite ceiling", () => {
    expect(jitterDelayMs(0, () => 0.9)).toBe(0);
    expect(jitterDelayMs(-100, () => 0.9)).toBe(0);
    expect(jitterDelayMs(Number.NaN, () => 0.9)).toBe(0);
  });

  it("tolerates a misbehaving RNG (NaN / out-of-range)", () => {
    expect(jitterDelayMs(5000, () => Number.NaN)).toBe(0);
    expect(jitterDelayMs(5000, () => -1)).toBe(0);
    expect(jitterDelayMs(5000, () => 2)).toBeLessThan(5000);
  });
});

describe("runDeriveBoardJob", () => {
  it("sleeps for the jittered delay before deriving", async () => {
    const sleep = vi.fn(async () => {});
    const deps = makeDeps({ sleep, rng: () => 0.5 });
    const summary = await runDeriveBoardJob(deps, { jitterMaxMs: 4000 });
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(summary.jitterMs).toBe(2000);
  });

  it("does not sleep when the jitter rounds to zero", async () => {
    const sleep = vi.fn(async () => {});
    await runDeriveBoardJob(makeDeps({ sleep, rng: () => 0 }));
    expect(sleep).not.toHaveBeenCalled();
  });

  it("defaults the jitter ceiling to DEFAULT_JITTER_MAX_MS", async () => {
    const sleep = vi.fn(async () => {});
    const summary = await runDeriveBoardJob(makeDeps({ sleep, rng: () => 0.999999 }));
    expect(summary.jitterMs).toBeLessThan(DEFAULT_JITTER_MAX_MS);
    expect(summary.jitterMs).toBeGreaterThan(0);
  });

  it("derives every company and tallies the results", async () => {
    const derive = vi.fn(async (id: string) => (id === "c2" ? ok(true) : ok()));
    const deps = makeDeps({
      listCompanies: async () => [{ id: "c1" }, { id: "c2" }, { id: "c3" }],
      derive,
    });
    const summary = await runDeriveBoardJob(deps);
    expect(derive).toHaveBeenCalledTimes(3);
    expect(summary).toMatchObject({ companies: 3, derived: 2, skipped: 1, failed: 0 });
  });

  it("isolates a derive that returns ok:false — others still run", async () => {
    const derive = vi.fn(async (id: string) => (id === "c1" ? fail("db down") : ok()));
    const deps = makeDeps({ derive });
    const summary = await runDeriveBoardJob(deps);
    expect(derive).toHaveBeenCalledTimes(2);
    expect(summary).toMatchObject({ companies: 2, derived: 1, failed: 1 });
  });

  it("isolates a derive that THROWS — the loop continues and tallies it failed", async () => {
    const derive = vi.fn(async (id: string) => {
      if (id === "c1") throw new Error("kaboom");
      return ok();
    });
    const logger = silentLogger();
    const summary = await runDeriveBoardJob(makeDeps({ derive, logger }));
    expect(derive).toHaveBeenCalledTimes(2);
    expect(summary).toMatchObject({ companies: 2, derived: 1, failed: 1 });
    expect(logger.error).toHaveBeenCalled();
  });

  it("handles an empty company set without deriving", async () => {
    const derive = vi.fn(async () => ok());
    const summary = await runDeriveBoardJob(makeDeps({ listCompanies: async () => [], derive }));
    expect(derive).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ companies: 0, derived: 0, skipped: 0, failed: 0 });
  });

  it("propagates only if listCompanies itself rejects", async () => {
    const deps = makeDeps({ listCompanies: async () => { throw new Error("no companies api"); } });
    await expect(runDeriveBoardJob(deps)).rejects.toThrow("no companies api");
  });
});
