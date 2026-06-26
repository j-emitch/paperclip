import { describe, expect, it } from "vitest";
import { deriveOrientation } from "../../src/projections/deriveOrientation.js";
import { parseOrientationV1 } from "../../src/contracts/orientation.js";
import { NOW, artifact, branchSignal, bundleOf, routine, work } from "../fixtures/signals.js";
import { taxonomyFixture } from "../fixtures/taxonomy.js";

const TAX = taxonomyFixture();

describe("deriveOrientation", () => {
  it("renders the default pinned briefing via PINNED_ROLE_TO_ROUTINE, skipping unresolved roles", () => {
    const o = deriveOrientation(
      bundleOf([
        routine("daily-standup", "daily", "company/reports/standup/*.md"),
        routine("weekly-strategic-summary", "weekly", "company/reports/strategy/*.md"),
        artifact("reports/standup/2026-06-23.md", { repo: "company", mtime: "2026-06-23T11:00:00.000Z" }),
      ]),
      NOW,
      TAX,
    );
    expect(o.briefing.map((c) => c.routineKey)).toEqual(["daily-standup", "weekly-strategic-summary"]);
    expect(o.briefing[0]!.verdict).toBe("fresh"); // standup artifact within the daily window
    expect(o.briefing[1]!.verdict).toBe("never_ran"); // no strategy artifact
    expect(() => parseOrientationV1(o)).not.toThrow();
  });

  it("derives metrics directly from signals (not from the board projection)", () => {
    const o = deriveOrientation(
      bundleOf([
        work("OB-01", "in_progress", "branch_path", { repo: "juice-bar" }),
        work("OB-02", "in_progress", "branch_path", { repo: "juice-bar" }),
        branchSignal("feat/x", { repo: "juice-bar", worktrees: [{ path: "/wt", headSha: "a", detached: false, dirtyFileCount: 5 }] }),
      ]),
      NOW,
      TAX,
    );
    expect(o.metrics.inProgress).toBe(2);
    expect(o.metrics.dirtyWorktrees).toBe(1);
  });

  it("flags alert-worthy branches with severity + project tag + a source deep-link (info excluded)", () => {
    const o = deriveOrientation(
      bundleOf([
        branchSignal("feat/conflict", { repo: "juice-bar", statuses: ["conflicting"], conflictsWithTrunk: true }),
        branchSignal("feat/clean", { repo: "juice-bar", statuses: ["ahead_clean"], ahead: 1, behind: 0 }),
      ]),
      NOW,
      TAX,
    );
    expect(o.branchHealth).toHaveLength(1); // ahead_clean is info → excluded
    expect(o.branchHealth[0]!.severity).toBe("high");
    expect(o.branchHealth[0]!.projectKey).toBe("juice-bar");
    expect(o.branchHealth[0]!.deepLink).toEqual({ tab: "source", repoKey: "juice-bar", branch: "feat/conflict" });
    expect(o.alerts.some((a) => a.kind === "branch_at_risk")).toBe(true);
  });

  it("a stale routine yields a routine alert deep-linking to the rendered doc", () => {
    const o = deriveOrientation(
      bundleOf([
        routine("daily-standup", "daily", "company/reports/standup/*.md"),
        artifact("reports/standup/2026-06-22.md", { repo: "company", mtime: "2026-06-22T00:00:00.000Z" }), // 1.5d old → stale
      ]),
      NOW,
      TAX,
    );
    const alert = o.alerts.find((a) => a.kind === "routine_stale");
    expect(alert).toBeDefined();
    expect(alert!.deepLink.tab).toBe("docs"); // links to the rendered report
  });
});
