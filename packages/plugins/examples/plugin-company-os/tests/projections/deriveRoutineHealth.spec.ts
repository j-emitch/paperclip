import { describe, expect, it } from "vitest";
import { cadenceWindowMs, deriveRoutineHealth } from "../../src/projections/deriveRoutineHealth.js";
import { parseRoutineHealthV1 } from "../../src/contracts/routine-health.js";
import { NOW, artifact, bundleOf, routine } from "../fixtures/signals.js";

// NOW = 2026-06-23T12:00:00Z
describe("deriveRoutineHealth", () => {
  it("cadenceWindowMs maps tokens; cron → null", () => {
    expect(cadenceWindowMs("daily")).toBe(86_400_000);
    expect(cadenceWindowMs("weekly")).toBe(604_800_000);
    expect(cadenceWindowMs("0 9 * * 1")).toBeNull();
  });

  it("fresh when a matching artifact is within the cadence window", () => {
    const health = deriveRoutineHealth(
      bundleOf([
        routine("daily-standup", "daily", "company/reports/standup/*.md"),
        artifact("reports/standup/2026-06-23.md", { repo: "company", mtime: "2026-06-23T08:00:00.000Z" }),
      ]),
      NOW,
    );
    expect(health.routines[0]).toMatchObject({
      routineKey: "daily-standup",
      verdict: "fresh",
      expectedArtifactPresent: true,
      latestArtifactPath: "reports/standup/2026-06-23.md",
    });
    expect(() => parseRoutineHealthV1(health)).not.toThrow();
  });

  it("stale when the newest artifact is 1–2 windows old", () => {
    const health = deriveRoutineHealth(
      bundleOf([
        routine("daily-standup", "daily", "company/reports/standup/*.md"),
        artifact("reports/standup/old.md", { repo: "company", mtime: "2026-06-22T00:00:00.000Z" }), // ~36h old
      ]),
      NOW,
    );
    expect(health.routines[0].verdict).toBe("stale");
  });

  it("missing when the newest artifact is older than 2 windows", () => {
    const health = deriveRoutineHealth(
      bundleOf([
        routine("daily-standup", "daily", "company/reports/standup/*.md"),
        artifact("reports/standup/ancient.md", { repo: "company", mtime: "2026-06-19T00:00:00.000Z" }), // >4 days
      ]),
      NOW,
    );
    expect(health.routines[0].verdict).toBe("missing");
  });

  it("never_ran when no artifact matches and no last-run", () => {
    const health = deriveRoutineHealth(
      bundleOf([routine("weekly-report", "weekly", "company/reports/weekly/*.md")]),
      NOW,
    );
    expect(health.routines[0]).toMatchObject({ verdict: "never_ran", expectedArtifactPresent: false, latestArtifactPath: null });
  });

  it("matches the monorepo-parent glob against the repo-relative artifact path", () => {
    const health = deriveRoutineHealth(
      bundleOf([
        routine("weekly-report", "weekly", "company/reports/weekly/*.md"),
        artifact("reports/weekly/w26.md", { repo: "company", mtime: "2026-06-23T00:00:00.000Z" }),
      ]),
      NOW,
    );
    expect(health.routines[0].verdict).toBe("fresh");
  });
});
