/**
 * COS-2f — SSR state-injection for the Teaching surface. Renders the PURE
 * `TeachingView` (+ the `render-slot`) with `renderToStaticMarkup` (no host bridge,
 * no DOM) and asserts each state surfaces its key content without throwing — the
 * same bridge-free guarantee the board/reports/routines rely on, and what lets the
 * Playwright harness screenshot the exact live tree.
 *
 * The load-bearing test is the FLAG-OFF BYTE-IDENTITY: `renderTeachingTabSlot(false)`
 * must equal a direct `PlaceholderPanel` render — proof the tab is dormant when off.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TeachingView } from "../../src/ui/teaching/TeachingView.js";
import { EMPTY_TEACHING_FILTER, type TeachingFilter } from "../../src/ui/teaching/teaching-view-model.js";
import { renderTeachingTabSlot, emptyTeachingOverview } from "../../src/render-slot.js";
import { PlaceholderPanel } from "../../src/ui/shared/placeholder-panel.js";
import { COMPANY_OS_TABS } from "../../src/ui/tabs.js";
import type { TeachingOverviewV1 } from "../../src/contracts/index.js";

const NOW = Date.parse("2026-07-02T00:00:00.000Z");
const noop = () => {};

function populated(over: Partial<TeachingOverviewV1> = {}): TeachingOverviewV1 {
  return {
    ...emptyTeachingOverview(),
    backlog: { pendingLogs: 2, pendingNuggets: 199, oldestPendingAt: "2026-06-22T00:00:00.000Z", oldestPendingAgeHours: 240 },
    synthesis: { lastSynthesisAt: null, ageHours: null, verdict: "never_ran" },
    attention: { level: "critical", reason: "199 nuggets across 2 logs awaiting synthesis — the synthesis has never run." },
    units: [
      { repo: "company", relPath: "docs/teachings/internal/units/03-migrations-and-staging/checksum.md", title: "Migration checksum drift", unit: "03-migrations-and-staging", lens: "internal", audience: "internal", publishState: "candidate", lastVerifiedAt: "2026-06-20T00:00:00.000Z", mtime: "2026-06-20T00:00:00.000Z" },
      { repo: "company", relPath: "docs/teachings/external/units/02-adversarial-review/codex.md", title: "Codex agentic invocation", unit: "02-adversarial-review", lens: "external", audience: "external", publishState: "published", lastVerifiedAt: null, mtime: "2026-07-01T00:00:00.000Z" },
    ],
    unitCounts: {
      total: 2,
      audience: { internal: 1, external: 1, both: 0 },
      publishState: { private: 0, candidate: 1, ready: 0, published: 1 },
      lens: { internal: 1, external: 1, unspecified: 0 },
    },
    ...over,
  };
}

function view(overview: TeachingOverviewV1, filter: TeachingFilter = EMPTY_TEACHING_FILTER) {
  return renderToStaticMarkup(<TeachingView overview={overview} filter={filter} onFilterChange={noop} now={NOW} />);
}

describe("Teaching SSR", () => {
  it("renders the populated corpus with the critical attention banner + loop cards", () => {
    const html = view(populated());
    expect(html).toContain("Teaching");
    expect(html).toContain("Loop stalled"); // critical headline
    expect(html).toContain("199"); // backlog nuggets
    expect(html).toContain("Backlog");
    expect(html).toContain("Synthesis");
    // unit lessons + their pills
    expect(html).toContain("Migration checksum drift");
    expect(html).toContain("Codex agentic invocation");
    expect(html).toContain("Candidate");
    expect(html).toContain("Published");
    // the faceted filter groups are present + labelled
    expect(html).toContain('aria-label="Filter by audience"');
    expect(html).toContain('aria-label="Filter by publish state"');
  });

  it("renders a healthy, drained corpus as OK", () => {
    const html = view(populated({ backlog: { pendingLogs: 0, pendingNuggets: 0, oldestPendingAt: null, oldestPendingAgeHours: null }, synthesis: { lastSynthesisAt: "2026-07-01T00:00:00.000Z", ageHours: 24, verdict: "fresh" }, attention: { level: "ok", reason: null } }));
    expect(html).toContain("Loop healthy");
    expect(html).toContain("All caught up");
  });

  it("renders an empty corpus without throwing", () => {
    const html = view(emptyTeachingOverview());
    expect(html).toContain("No teaching units yet");
    expect(html).toContain("Loop healthy"); // empty + never-run reads as idle-ok
  });

  it("renders an explicit no-match when filters exclude everything", () => {
    const html = view(populated(), { ...EMPTY_TEACHING_FILTER, audience: "both" });
    expect(html).toContain("No lessons match these filters.");
  });
});

describe("render-slot flag-off byte-identity (COS-2f)", () => {
  it("flag OFF renders the EXACT COS-0 placeholder (dormant when off)", () => {
    const teachingTab = COMPANY_OS_TABS.find((t) => t.key === "teaching");
    if (!teachingTab) throw new Error("no teaching tab");
    const slot = renderTeachingTabSlot(false);
    const placeholder = renderToStaticMarkup(<PlaceholderPanel tab={teachingTab} />);
    expect(slot).toBe(placeholder); // byte-identical
    expect(slot).toContain("live in COS-2");
    expect(slot).toContain("arrives in");
  });

  it("flag ON renders the live Teaching shell", () => {
    const slot = renderTeachingTabSlot(true);
    expect(slot).toContain("Teaching");
    expect(slot).toContain("Backlog");
    expect(slot).not.toContain("arrives in"); // not the placeholder
  });
});

describe("Teaching surface freshness (B4)", () => {
  it("renders the shared SurfaceFreshnessBadge instead of the bespoke stale-pill loop", () => {
    const html = view(populated());
    expect(html).toContain("Teaching is stale"); // populated() rides emptyTeachingOverview's epoch derivedAt
  });
});

describe("Teaching synthesis SLO card (B10)", () => {
  it("renders the synthesis tile through the shared RoutineSloCard", () => {
    const html = view(populated());
    expect(html).toContain('data-slo-variant="card"');
    expect(html).toContain("Librarian Routine 12");
    expect(html).toContain("Never ran"); // populated() synthesis verdict = never_ran, via the shared verdict ladder
  });
});
