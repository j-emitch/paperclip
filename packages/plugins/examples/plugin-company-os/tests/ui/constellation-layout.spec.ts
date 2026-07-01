/**
 * Pure coverage for the org-constellation layout. The layout is a deterministic
 * function of the (fixed) agent set + handoffs — no force-directed randomness —
 * so the SSR tree is byte-stable and the Playwright harness screenshots an
 * identical diagram every run.
 */

import { describe, expect, it } from "vitest";
import { buildConstellationLayout } from "../../src/ui/agents/constellation-layout.js";
import { statusColors } from "../../src/ui/tokens.js";
import { goldenAgentSystem } from "./fixtures/agents.js";

describe("buildConstellationLayout — desktop", () => {
  it("places the CEO at the apex and the reports on the next tier", () => {
    const system = goldenAgentSystem();
    const layout = buildConstellationLayout(system.agents, system.handoffs, { mobile: false });
    expect(layout.nodes).toHaveLength(4);
    const ceo = layout.nodes.find((n) => n.displayName === "CEO");
    const cto = layout.nodes.find((n) => n.displayName === "CTO");
    expect(ceo?.depth).toBe(0);
    expect(cto?.depth).toBe(1);
    expect(ceo!.y).toBeLessThan(cto!.y);
  });

  it("tints nodes by health rollup (fresh green, null neutral)", () => {
    const system = goldenAgentSystem();
    const layout = buildConstellationLayout(system.agents, system.handoffs, { mobile: false });
    expect(layout.nodes.find((n) => n.displayName === "CEO")?.tone).toBe(statusColors.live);
    expect(layout.nodes.find((n) => n.displayName === "Librarian")?.tone).toBe(statusColors.reviewUnknown);
  });

  it("draws lineage edges for every report plus the handoff connectors", () => {
    const system = goldenAgentSystem();
    const layout = buildConstellationLayout(system.agents, system.handoffs, { mobile: false });
    const lineage = layout.edges.filter((e) => e.kind === "lineage");
    const handoff = layout.edges.filter((e) => e.kind === "handoff");
    expect(lineage).toHaveLength(3); // COO, CTO, Librarian -> CEO
    expect(handoff).toHaveLength(3); // CEO->CTO, COO->Librarian, CTO->CEO
    const mismatch = handoff.find((e) => e.from === "COO" && e.to === "Librarian");
    expect(mismatch?.consistent).toBe(false);
    for (const e of layout.edges) expect(e.path.startsWith("M")).toBe(true);
  });

  it("is deterministic — identical input yields identical coordinates", () => {
    const system = goldenAgentSystem();
    const a = buildConstellationLayout(system.agents, system.handoffs, { mobile: false });
    const b = buildConstellationLayout(system.agents, system.handoffs, { mobile: false });
    expect(a).toEqual(b);
  });
});

describe("buildConstellationLayout — mobile", () => {
  it("reflows to a vertical stack and drops the crossing handoff curves", () => {
    const system = goldenAgentSystem();
    const layout = buildConstellationLayout(system.agents, system.handoffs, { mobile: true });
    expect(layout.mobile).toBe(true);
    const ys = layout.nodes.map((n) => n.y);
    const sorted = [...ys].sort((a, b) => a - b);
    expect(ys).toEqual(sorted); // canonical order stacks top-to-bottom
    expect(new Set(ys).size).toBe(4); // no two nodes share a row
    expect(layout.edges.every((e) => e.kind === "lineage")).toBe(true);
  });
});
