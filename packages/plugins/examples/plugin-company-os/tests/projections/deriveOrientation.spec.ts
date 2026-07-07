import { describe, expect, it } from "vitest";
import { deriveOrientation } from "../../src/projections/deriveOrientation.js";
import { parseOrientationV1 } from "../../src/contracts/orientation.js";
import { NOW, artifact, branchSignal, bundleOf, repoGitSignal, routine, work } from "../fixtures/signals.js";
import { taxonomyFixture } from "../fixtures/taxonomy.js";

const TAX = taxonomyFixture();

describe("deriveOrientation", () => {
  it("renders the default pinned briefing in the ratified order via PINNED_ROLE_TO_ROUTINE, skipping unresolved roles", () => {
    const o = deriveOrientation(
      bundleOf([
        routine("daily-standup", "daily", "company/reports/standup/*.md"),
        routine("daily-health-scan", "daily", "company/reports/health/*.md", { ownerAgent: "COO" }),
        routine("weekly-strategic-summary", "weekly", "company/reports/strategy/*.md"),
        artifact("reports/standup/2026-06-23.md", { repo: "company", mtime: "2026-06-23T11:00:00.000Z" }),
        artifact("reports/health/2026-06-23.md", { repo: "company", mtime: "2026-06-23T11:00:00.000Z" }),
      ]),
      NOW,
      TAX,
    );
    // daily-health-scan pins 2nd (COS-1R-f ratified order); the absent
    // codebase-health / process-audit / weekly-summary roles are skipped.
    expect(o.briefing.map((c) => c.routineKey)).toEqual([
      "daily-standup",
      "daily-health-scan",
      "weekly-strategic-summary",
    ]);
    expect(o.briefing[0]!.verdict).toBe("fresh"); // standup artifact within the daily window
    expect(o.briefing[1]!.verdict).toBe("fresh"); // health-scan artifact within the daily window
    expect(o.briefing[2]!.verdict).toBe("never_ran"); // no strategy artifact
    expect(() => parseOrientationV1(o)).not.toThrow();
  });

  it("excludes embedded routines from the pinned briefing", () => {
    const o = deriveOrientation(
      bundleOf([
        routine("daily-standup", "daily", "", {
          ownerAgent: "CTO",
          freshnessKind: "embedded",
        }),
        routine("weekly-report", "weekly", "company/reports/weekly/*.md", {
          ownerAgent: "CTO",
          freshnessKind: "artifact",
        }),
        artifact("reports/weekly/w26.md", { repo: "company", mtime: "2026-06-23T00:00:00.000Z" }),
      ]),
      NOW,
      TAX,
    );

    expect(o.briefing.map((c) => c.routineKey)).toEqual(["weekly-report"]);
    expect(o.briefing[0]).toMatchObject({ verdict: "fresh", freshnessKind: "artifact" });
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

  it("gives every detached checkout of the same repo a UNIQUE alert id (live dup-key regression)", () => {
    const o = deriveOrientation(
      bundleOf([
        branchSignal(null, { repo: "company", statuses: ["conflicting"], conflictsWithTrunk: true, headSha: "aaa1111" }),
        branchSignal(null, { repo: "company", statuses: ["conflicting"], conflictsWithTrunk: true, headSha: "bbb2222" }),
      ]),
      NOW,
      TAX,
    );
    const ids = o.alerts.filter((a) => a.kind === "branch_at_risk").map((a) => a.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
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

  it("folds a budget-exhausted repo's diagnostic into Home (never an invisible all-clear)", () => {
    // A budget-exceeded repo's branches drop out of branchHealth (severity low), so
    // without folding the RepoGitSignal diagnostic Home would show a false all-clear.
    const o = deriveOrientation(
      bundleOf([
        repoGitSignal("juice-bar", {
          diagnostics: [{ level: "warn", code: "git_budget_exceeded", message: "budget", repo: "juice-bar", source: "branch" }],
        }),
      ]),
      NOW,
      TAX,
    );
    expect(o.diagnostics.some((d) => d.code === "git_budget_exceeded")).toBe(true);
  });
});
