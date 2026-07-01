/**
 * SSR coverage for the shared `RoutineSloCard`. The `card` variant is the
 * standalone Routines board tile; the `row` variant is the divider-separated form
 * nested inside an AgentCard's owned-routines drawer (no card-in-card). Both
 * render every field the old inline `RoutineCard` did — this is the regression
 * guard for the 1R-e.1 extraction.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RoutineSloCard } from "../../src/ui/shared/RoutineSloCard.js";
import type { RoutineSloView } from "../../src/ui/shared/routine-slo-view.js";

const NOW = Date.parse("2026-07-01T12:00:00Z");

function routine(overrides: Partial<RoutineSloView> = {}): RoutineSloView {
  return {
    routineKey: "daily-standup",
    displayName: "Daily Standup",
    cadence: "daily",
    freshnessKind: "artifact",
    expectedArtifactGlob: "company/reports/standup/*.md",
    lastRunAt: "2026-07-01T09:00:00Z",
    nextExpectedAt: "2026-07-02T09:00:00Z",
    expectedArtifactPresent: true,
    latestArtifactPath: "company/reports/standup/2026-07-01.md",
    verdict: "fresh",
    detail: "on cadence",
    ...overrides,
  };
}

describe("RoutineSloCard — card variant", () => {
  it("renders name, verdict, cadence, artifact presence, path, and detail", () => {
    const html = renderToStaticMarkup(<RoutineSloCard routine={routine()} now={NOW} />);
    expect(html).toContain('data-slo-variant="card"');
    expect(html).toContain("Daily Standup");
    expect(html).toContain("Fresh");
    expect(html).toContain("daily");
    expect(html).toContain("present");
    expect(html).toContain("company/reports/standup/2026-07-01.md");
    expect(html).toContain("on cadence");
    // The signature left-accent belongs to the full card.
    expect(html).toContain("border-left:3px");
  });

  it("renders a null-verdict embedded routine as a calm Duties-only card, no crash", () => {
    const html = renderToStaticMarkup(
      <RoutineSloCard
        routine={routine({
          displayName: "Wiki Maintenance",
          freshnessKind: "embedded",
          expectedArtifactGlob: "",
          verdict: null,
          expectedArtifactPresent: false,
          latestArtifactPath: null,
          nextExpectedAt: null,
          detail: null,
        })}
        now={NOW}
      />,
    );
    expect(html).toContain("Wiki Maintenance");
    expect(html).toContain("Duties only");
    expect(html).toContain("duties only");
  });

  it("labels a past next-expected as Overdue, not a contradictory countdown", () => {
    const html = renderToStaticMarkup(
      <RoutineSloCard routine={routine({ nextExpectedAt: "2026-06-25T09:00:00Z", verdict: "stale" })} now={NOW} />,
    );
    expect(html).toContain("Overdue");
  });
});

describe("RoutineSloCard — row variant", () => {
  it("renders the same routine without the full-card left accent (dividers, not card-in-card)", () => {
    const html = renderToStaticMarkup(<RoutineSloCard routine={routine()} now={NOW} variant="row" />);
    expect(html).toContain('data-slo-variant="row"');
    expect(html).toContain("Daily Standup");
    expect(html).toContain("Fresh");
    expect(html).not.toContain("border-left:3px");
  });
});
