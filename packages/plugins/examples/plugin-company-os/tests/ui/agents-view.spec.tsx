/**
 * SSR coverage for the Agents cockpit view — the D-14 elevation. Renders the pure
 * `AgentsView` with `renderToStaticMarkup` (no host bridge) and asserts every
 * region surfaces: vitals masthead, the org constellation, the four-agent roster
 * with identity + health, coordination intel (overlaps + handoff ledger), and the
 * diagnostics rail — plus the explicit all-clear zero-states.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentsView } from "../../src/ui/agents/AgentsView.js";
import { goldenAgentSystem, emptyAgentSystem, AGENTS_NOW } from "./fixtures/agents.js";

function render(system = goldenAgentSystem(), extra: Partial<Parameters<typeof AgentsView>[0]> = {}) {
  return renderToStaticMarkup(<AgentsView system={system} now={AGENTS_NOW} {...extra} />);
}

describe("AgentsView — populated", () => {
  it("renders the vitals masthead figures", () => {
    const html = render();
    expect(html).toContain("Agents");
    expect(html).toContain("$170/mo"); // total monthly budget
    expect(html).toContain("33%"); // routines fresh
    expect(html).toContain("daily"); // heartbeat cadence
  });

  it("renders the org constellation as a labelled SVG with every agent", () => {
    const html = render();
    expect(html).toContain("<svg");
    expect(html).toContain("org constellation");
    for (const agent of ["CEO", "COO", "CTO", "Librarian"]) expect(html).toContain(agent);
  });

  it("renders the four-agent roster with role, health, budget, and drift chips", () => {
    const html = render();
    expect(html).toContain("Fresh"); // CEO health rollup
    expect(html).toContain("Missing"); // COO
    expect(html).toContain("Stale"); // CTO
    expect(html).toContain("Duties only"); // Librarian (null rollup)
    expect(html).toContain("$80/mo"); // CTO budget
    expect(html).toContain("drift"); // the model-drift chip
    expect(html).toContain("creates agents"); // CEO canCreateAgents
    expect(html).toContain("500 turns"); // Librarian maxTurnsPerRun
  });

  it("renders coordination intel — the resolved overlap and the handoff ledger", () => {
    const html = render();
    expect(html).toContain("company/docs"); // overlap surface
    expect(html).toContain("Librarian owns content freshness"); // resolution recommendation
    expect(html).toContain("does not list COO"); // the handoff mismatch, surfaced
  });

  it("renders the diagnostics rail worst-first with the handoff-mismatch warning", () => {
    const html = render();
    expect(html).toContain("Diagnostics");
    expect(html).toContain("hands off to Librarian");
  });

  it("focuses the selected agent when given a selectedAgentKey", () => {
    const html = render(goldenAgentSystem(), { selectedAgentKey: "cto" });
    expect(html).toContain('data-selected-agent="cto"');
  });

  it("exposes interactive button affordances on the constellation when onSelectAgent is provided", () => {
    const html = render(goldenAgentSystem(), { onSelectAgent: () => {} });
    expect(html).toContain('role="button"');
    expect(html).toContain("aria-pressed");
    expect(html).toContain('tabindex="0"');
  });

  it("stays a static, non-interactive tree when onSelectAgent is omitted", () => {
    const html = render();
    expect(html).not.toContain('role="button"');
    expect(html).not.toContain("aria-pressed");
  });
});

describe("AgentsView — zero-state", () => {
  it("renders explicit all-clear states for a company with no agents, no crash", () => {
    const html = render(emptyAgentSystem());
    expect(html).toContain("No agents");
    expect(html).toContain("All systems nominal");
    expect(html).toContain("No duty overlaps");
  });
});

describe("Agents surface freshness (B4)", () => {
  it("renders the shared SurfaceFreshnessBadge (the tab previously had NO freshness treatment)", () => {
    const html = render();
    expect(html).toMatch(/Agents is (live|stale)/);
  });
});
