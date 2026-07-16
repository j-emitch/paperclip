import { describe, expect, it } from "vitest";
import { deriveOrientation } from "../../src/projections/deriveOrientation.js";
import { parseOrientationV1 } from "../../src/contracts/orientation.js";
import { NOW, artifact, branchSignal, bundleOf, docSignal, landedPr, repoGitSignal, routine, taxon, work } from "../fixtures/signals.js";
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

describe("COS-8a — Home's branch health folds PR-action statuses (one-ladder rule)", () => {
  it("a clean branch with a changes-requested PR enters Home's attention band as medium", () => {
    const o = deriveOrientation(
      bundleOf([
        branchSignal("claude/COS-1/x", { repo: "juice-bar", statuses: [] }),
        work("COS-1", "in_review", "pr_scope", {
          source: "pull-request",
          repo: "juice-bar",
          prNumber: 31,
          headRef: "claude/COS-1/x",
          prReviewDecision: "changes_requested",
        }),
      ]),
      NOW,
      taxonomyFixture(),
    );
    const entry = o.branchHealth.find((b) => b.branch === "claude/COS-1/x");
    expect(entry).toBeDefined();
    expect(entry!.statuses).toContain("pr_changes_requested");
    expect(entry!.severity).toBe("medium");
  });

  it("review_required alone does NOT reach the attention band (low)", () => {
    const o = deriveOrientation(
      bundleOf([
        branchSignal("claude/COS-2/y", { repo: "juice-bar", statuses: [] }),
        work("COS-2", "in_review", "pr_scope", {
          source: "pull-request",
          repo: "juice-bar",
          prNumber: 32,
          headRef: "claude/COS-2/y",
          prReviewDecision: "review_required",
        }),
      ]),
      NOW,
      taxonomyFixture(),
    );
    expect(o.branchHealth.find((b) => b.branch === "claude/COS-2/y")).toBeUndefined();
  });
});

describe("deriveOrientation — C3 (TBD lane + shipped-this-week + plan gaps)", () => {
  const TAX = taxonomyFixture();

  it("surfaces next_up work in tbdWork (no longer dropped) and keeps it out of recentWork", () => {
    const o = deriveOrientation(
      bundleOf([
        work("OM-15", "next_up", "spec_frontmatter", { repo: "juice-bar", title: "Pay-rate UI" }),
        work("SSF-04", "in_progress", "branch_path", { repo: "juice-bar" }),
      ]),
      NOW,
      TAX,
    );
    expect(o.tbdWork.map((w) => w.title)).toEqual(["Pay-rate UI"]);
    expect(o.tbdWork[0]?.status).toBe("next_up");
    expect(o.recentWork.some((w) => w.title === "Pay-rate UI")).toBe(false);
    expect(() => parseOrientationV1(o)).not.toThrow(); // v3 round-trip
  });

  it("counts distinct PRs landed within 7d — repo-scoped keys, old PRs excluded", () => {
    const o = deriveOrientation(
      bundleOf([
        landedPr(12), // 1d ago (builder default)
        landedPr(12, { repo: "paperclip" }), // same number, other repo — distinct
        landedPr(9, { landedAt: new Date(NOW - 9 * 86_400_000).toISOString() }), // 9d — out of window
      ]),
      NOW,
      TAX,
    );
    expect(o.metrics.shippedThisWeek).toBe(2);
  });

  it("counts plan gaps only for REGISTERED families with a main spec and no plan", () => {
    const o = deriveOrientation(
      bundleOf([
        taxon("COS", "Company OS", "JB", "Company-OS"),
        taxon("MTP", "Coaching", "JB", "Coaching"),
        docSignal("specs/COS.md", { docType: "spec", prefix: "COS" }),
        docSignal("docs/superpowers/plans/COS-plan.md", { docType: "plan", prefix: "COS" }),
        docSignal("specs/MTP.md", { docType: "spec", prefix: "MTP" }), // spec, no plan → the gap
        docSignal("specs/XYZ.md", { docType: "spec", prefix: "XYZ" }), // unregistered → not counted
        // A worktree spec never creates a gap on its own (in-flight draft, not canon).
        docSignal("specs/COS.md", { docId: "wt", checkoutId: "worktree:aaa", checkoutKey: "company::wt::aaa", docType: "spec", prefix: "COS" }),
      ]),
      NOW,
      TAX,
    );
    expect(o.metrics.planGaps).toBe(1);
  });

  it("a ticket already moving never double-lists in the TBD lane (inline-lane fold)", () => {
    const o = deriveOrientation(
      bundleOf([
        work("SSF-04", "next_up", "spec_frontmatter", { repo: "juice-bar", title: "Spec says queued" }),
        work("SSF-04", "in_progress", "branch_path", { repo: "juice-bar", title: "Git says moving" }),
      ]),
      NOW,
      TAX,
    );
    expect(o.tbdWork).toEqual([]);
    expect(o.recentWork.some((w) => w.title === "Git says moving")).toBe(true);
  });
});
