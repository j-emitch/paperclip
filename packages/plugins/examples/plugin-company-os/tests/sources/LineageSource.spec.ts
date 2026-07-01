import { describe, expect, it } from "vitest";
import { lineageSource } from "../../src/sources/LineageSource.js";
import { isLineageSignal, type LineageSignal } from "../../src/contracts/signals.js";
import type { LineageData } from "../../src/contracts/lineage.js";
import { makeFixtureContext } from "../fixtures/context.js";

const GRAPH: LineageData = {
  laneGroups: [
    { id: "vc", title: "Value Chain", kind: "flow", lanes: [{ id: "l1", title: "Coaching", families: ["MTP", "TAP"] }] },
    { id: "sb", title: "Second Brain", kind: "second-brain", lanes: [{ id: "l2", title: "OS", families: ["COS"] }] },
  ],
  edges: [{ from: "TAP", to: "MTP", kind: "consumes" }],
};

describe("LineageSource", () => {
  it("emits one LineageSignal carrying the loaded graph", async () => {
    const ctx = makeFixtureContext({ repos: [{ repo: "company", available: true }], lineage: GRAPH });
    const batch = await lineageSource.collect(ctx);
    const sigs = batch.signals.filter(isLineageSignal) as LineageSignal[];
    expect(sigs).toHaveLength(1);
    expect(sigs[0].laneGroups).toHaveLength(2);
    expect(sigs[0].edges).toEqual([{ from: "TAP", to: "MTP", kind: "consumes" }]);
    expect(sigs[0].repo).toBe("company");
    expect(batch.repoFreshness[0]?.freshness).toBe("live");
  });

  it("degrades to no signal + stale freshness when the graph fails to load", async () => {
    const ctx = makeFixtureContext({
      repos: [{ repo: "company", available: true }],
      lineage: async () => ({ data: null, errors: [{ code: "parse_error", message: "boom", degraded: true }] }),
    });
    const batch = await lineageSource.collect(ctx);
    expect(batch.signals.filter(isLineageSignal)).toHaveLength(0);
    expect(batch.repoFreshness[0]?.freshness).toBe("stale");
    expect(batch.repoFreshness[0]?.errors[0]?.message).toBe("boom");
  });

  it("emits nothing on a scoped refresh that doesn't touch company", async () => {
    const ctx = makeFixtureContext({
      repos: [{ repo: "company", available: true }, { repo: "juice-bar", available: true }],
      scopeRepo: "juice-bar",
      lineage: GRAPH,
    });
    const batch = await lineageSource.collect(ctx);
    expect(batch.signals).toHaveLength(0);
    expect(batch.repoFreshness).toHaveLength(0);
  });
});
