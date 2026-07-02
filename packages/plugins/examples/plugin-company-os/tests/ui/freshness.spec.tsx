import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { SourceFreshness } from "../../src/contracts/index.js";
import { StaleSourcePills, SurfaceFreshnessBadge } from "../../src/ui/shared/freshness.js";

const NOW = Date.parse("2026-07-02T12:00:00.000Z");
const iso = (offsetMs: number): string => new Date(NOW + offsetMs).toISOString();
const STALE_MS = 5 * 60 * 1000;

const src = (over: Partial<SourceFreshness> = {}): SourceFreshness => ({
  source: "git-work",
  repo: "juice-bar",
  freshness: "live",
  lastOkAt: iso(0),
  errorCount: 0,
  message: null,
  ...over,
});

describe("SurfaceFreshnessBadge — one badge for every surface", () => {
  it("live: names the surface via `noun` + pulses (no stale text)", () => {
    const html = renderToStaticMarkup(<SurfaceFreshnessBadge noun="Board" derivedAt={iso(-1000)} sources={[src()]} now={NOW} />);
    expect(html).toContain("Board is live — derived just now");
    expect(html).toContain("cos-fx-live-dot"); // the live pulse dot
    expect(html).not.toContain("stale");
  });

  it("stale: shows `· stale` + counts non-live sources in the a11y label", () => {
    const html = renderToStaticMarkup(
      <SurfaceFreshnessBadge noun="Atlas" derivedAt={iso(-(STALE_MS + 60_000))} sources={[src({ freshness: "stale" }), src({ repo: "arc", freshness: "live" })]} now={NOW} />,
    );
    expect(html).toContain("Atlas is stale — derived 6m ago, 1 source not live");
    expect(html).toContain("· stale");
    expect(html).not.toContain("cos-fx-live-dot"); // no pulse when stale
  });

  it("clock skew: a future derive reads as skew, not live, and keeps the noun", () => {
    const html = renderToStaticMarkup(<SurfaceFreshnessBadge noun="Branch · PR" derivedAt={iso(120_000)} sources={[]} now={NOW} />);
    expect(html).toContain("Branch · PR derive timestamp is in the future");
    expect(html).toContain("clock skew");
    expect(html).not.toContain("is live");
  });

  it("pluralises the stale-source count", () => {
    const html = renderToStaticMarkup(
      <SurfaceFreshnessBadge noun="Board" derivedAt={iso(-(STALE_MS + 1000))} sources={[src({ freshness: "stale" }), src({ repo: "arc", freshness: "cached" })]} now={NOW} />,
    );
    expect(html).toContain("2 sources not live");
  });
});

describe("StaleSourcePills — honest per-source degradation", () => {
  it("renders nothing when every source is live", () => {
    expect(renderToStaticMarkup(<StaleSourcePills sources={[src(), src({ repo: "arc" })]} />)).toBe("");
  });

  it("labels each non-live source `source · repo · freshness`, repo-distinguished", () => {
    const html = renderToStaticMarkup(<StaleSourcePills sources={[src({ source: "pull-request", repo: "juice-bar", freshness: "stale" })]} />);
    expect(html).toContain("pull-request · juice-bar stale");
  });

  it("appends the error count (a superset of the retired board badge — no info lost)", () => {
    const two = renderToStaticMarkup(<StaleSourcePills sources={[src({ freshness: "stale", errorCount: 2 })]} />);
    expect(two).toContain("git-work · juice-bar stale · 2 errors");
    const one = renderToStaticMarkup(<StaleSourcePills sources={[src({ freshness: "cached", errorCount: 1 })]} />);
    expect(one).toContain("· 1 error");
    expect(one).not.toContain("1 errors");
  });

  it("reveals the exact last-ok timestamp on hover (title), never in the label", () => {
    const html = renderToStaticMarkup(<StaleSourcePills sources={[src({ freshness: "stale", lastOkAt: "2026-07-02T11:00:00.000Z" })]} />);
    expect(html).toContain("last ok 2026-07-02T11:00:00.000Z");
    const never = renderToStaticMarkup(<StaleSourcePills sources={[src({ freshness: "stale", lastOkAt: null })]} />);
    expect(never).toContain("never read successfully");
  });
});

describe("SurfaceFreshnessBadge — 5i.2 polish (hover affordance)", () => {
  it("tags the badge with a tone-specific hover class per state", () => {
    const live = renderToStaticMarkup(<SurfaceFreshnessBadge noun="Board" derivedAt={iso(-1000)} sources={[]} now={NOW} />);
    expect(live).toContain("cos-fx-fresh cos-fx-fresh-live");
    const stale = renderToStaticMarkup(<SurfaceFreshnessBadge noun="Board" derivedAt={iso(-(STALE_MS + 1000))} sources={[]} now={NOW} />);
    expect(stale).toContain("cos-fx-fresh-stale");
    const skew = renderToStaticMarkup(<SurfaceFreshnessBadge noun="Board" derivedAt={iso(120_000)} sources={[]} now={NOW} />);
    expect(skew).toContain("cos-fx-fresh-skew");
  });

  it("reveals the exact derive timestamp on hover (title), keeps the relative label for a11y", () => {
    const html = renderToStaticMarkup(<SurfaceFreshnessBadge noun="Atlas" derivedAt="2026-07-02T11:59:00.000Z" sources={[]} now={NOW} />);
    // aria-label stays relative; title carries the exact stamp.
    expect(html).toContain('aria-label="Atlas is live — derived 1m ago"');
    expect(html).toContain("derived 2026-07-02T11:59:00.000Z");
  });
});
