import { describe, expect, it } from "vitest";
import { reviewReportSource } from "../../src/sources/ReviewReportSource.js";
import { isReviewSignal } from "../../src/contracts/signals.js";
import { makeFixtureContext } from "../fixtures/context.js";

const CANNONS = `---
type: cannons-report
repo: juice-bar
branch: feat/OB-01-step-engine
commit: 9f88f92ecafebabe000000000000000000000000
verdict: ship
p0_count: 0
p1_count: 1
p2_count: 2
run_at: 2026-05-01T20:34:00Z
---
## summary`;

describe("ReviewReportSource", () => {
  it("emits a ReviewSignal carrying the full In-review join key", async () => {
    const ctx = makeFixtureContext({
      repos: [{ repo: "juice-bar", available: true }],
      files: {
        "juice-bar": { "reports/review-cannons/2026-05-01-OB-01.md": { content: CANNONS, mtime: "2026-05-01T20:34:10.000Z" } },
      },
    });
    const reviews = (await reviewReportSource.collect(ctx)).signals.filter(isReviewSignal);
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({
      kind: "review",
      reportKind: "cannons",
      repo: "juice-bar",
      sha: "9f88f92ecafebabe000000000000000000000000",
      verdict: "ship",
      generatedAt: "2026-05-01T20:34:00Z",
      p0: 0,
      p1: 1,
      p2: 2,
      branch: "feat/OB-01-step-engine",
    });
  });

  it("classifies reports/reviews/** as reportKind review and falls back to file mtime for generatedAt", async () => {
    const ctx = makeFixtureContext({
      repos: [{ repo: "juice-bar", available: true }],
      files: {
        "juice-bar": {
          "reports/reviews/x.md": { content: `---\nrepo: juice-bar\ncommit: abc\nverdict: revise\n---\n`, mtime: "2026-06-01T00:00:00.000Z" },
        },
      },
    });
    const r = (await reviewReportSource.collect(ctx)).signals.filter(isReviewSignal)[0];
    expect(r.reportKind).toBe("review");
    expect(r.verdict).toBe("revise");
    expect(r.generatedAt).toBe("2026-06-01T00:00:00.000Z");
    expect(r.prNumber).toBeUndefined();
  });

  it("a report without frontmatter → parse_error (non-degrading), no signal", async () => {
    const ctx = makeFixtureContext({
      repos: [{ repo: "juice-bar", available: true }],
      files: { "juice-bar": { "reports/review-cannons/bad.md": { content: "no frontmatter here" } } },
    });
    const batch = await reviewReportSource.collect(ctx);
    expect(batch.signals).toEqual([]);
    expect(batch.repoFreshness[0].errors.some((e) => e.code === "parse_error")).toBe(true);
    expect(batch.repoFreshness[0].freshness).toBe("live"); // non-degrading parse miss
  });

  it("no reports on disk → empty (absence is meaningful, not an error)", async () => {
    const ctx = makeFixtureContext({ repos: [{ repo: "juice-bar", available: true }], files: { "juice-bar": {} } });
    const batch = await reviewReportSource.collect(ctx);
    expect(batch.signals).toEqual([]);
    expect(batch.repoFreshness[0].freshness).toBe("live");
  });
});
