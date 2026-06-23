import { describe, expect, it } from "vitest";
import { prefixRegistrySource } from "../../src/sources/PrefixRegistrySource.js";
import { isTaxonomySignal } from "../../src/contracts/signals.js";
import type { RegistryEntry } from "../../src/contracts/registry.js";
import { makeFixtureContext } from "../fixtures/context.js";

const ENTRIES: RegistryEntry[] = [
  { prefix: "COS", family: "Company OS cockpit", l1_system: "Company", l2_subsystem: "Company-OS", description: "x", is_generic: false, created_at: "2026-06-23" },
  { prefix: "IMPRV", family: "Improvements", l1_system: "JB", l2_subsystem: "Platform-infra", description: "y", is_generic: true, created_at: null },
];

describe("PrefixRegistrySource", () => {
  it("emits a TaxonomySignal per registry row (via the injected loader)", async () => {
    const ctx = makeFixtureContext({ registry: ENTRIES });
    const tax = (await prefixRegistrySource.collect(ctx)).signals.filter(isTaxonomySignal);
    expect(tax.map((t) => t.prefix)).toEqual(["COS", "IMPRV"]);
    expect(tax[0]).toMatchObject({ family: "Company OS cockpit", l1System: "Company", l2Subsystem: "Company-OS", isGeneric: false, repo: "company" });
    expect(tax[1].isGeneric).toBe(true);
  });

  it("a scoped refresh of another repo leaves the taxonomy untouched (no signals)", async () => {
    const ctx = makeFixtureContext({ registry: ENTRIES, scopeRepo: "juice-bar" });
    const batch = await prefixRegistrySource.collect(ctx);
    expect(batch.signals).toEqual([]);
    expect(batch.repoFreshness).toEqual([]);
  });

  it("a load failure → stale freshness, no crash", async () => {
    const ctx = makeFixtureContext({
      registry: async () => ({ entries: [], errors: [{ code: "parse_error", message: "boom", degraded: true }] }),
    });
    const batch = await prefixRegistrySource.collect(ctx);
    expect(batch.signals).toEqual([]);
    expect(batch.repoFreshness[0]).toMatchObject({ repo: "company", freshness: "stale" });
  });

  it("company repo unavailable → stale freshness", async () => {
    const ctx = makeFixtureContext({ registry: ENTRIES, repos: [{ repo: "company", available: false }] });
    const batch = await prefixRegistrySource.collect(ctx);
    expect(batch.repoFreshness[0]).toMatchObject({ repo: "company", freshness: "stale" });
  });
});
