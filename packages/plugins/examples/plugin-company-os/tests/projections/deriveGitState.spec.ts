import { describe, expect, it } from "vitest";
import { deriveGitState } from "../../src/projections/deriveGitState.js";
import { parseGitStateV1 } from "../../src/contracts/git-state.js";
import { NOW, branchSignal, bundleOf, landedPr, repoGitSignal, review, work } from "../fixtures/signals.js";
import { taxonomyFixture } from "../fixtures/taxonomy.js";
import type { WorkSignal } from "../../src/contracts/signals.js";

const TAX = taxonomyFixture();

/** A PR work signal (as PullRequestSource emits) for the Branch·PR join tests. */
function prWork(prNumber: number, headRef: string, sha: string, over: Partial<WorkSignal> = {}): WorkSignal {
  return work(over.ticketId ?? "COS-1", "in_review", "pr_scope", {
    source: "pull-request",
    repo: over.repo ?? "juice-bar",
    prNumber,
    sha,
    headRef,
    isDraft: over.isDraft ?? false,
    url: `https://x/pull/${prNumber}`,
    title: `feat: pr ${prNumber}`,
    ...over,
  });
}

describe("deriveGitState", () => {
  it("groups repos by project family, primary first, with absent-repo 0-rows", () => {
    const gs = deriveGitState(
      bundleOf([
        repoGitSignal("company"),
        repoGitSignal("juice-bar"),
        branchSignal("main", { repo: "juice-bar" }),
        repoGitSignal("arc-scraper", { availability: "missing", trunk: { ref: null, state: "missing" } }),
      ]),
      NOW,
      TAX,
    );
    expect(gs.groups.map((g) => g.group.key)).toEqual(["company", "juice-bar", "viacava-arts", "paperclip"]);
    const jb = gs.groups.find((g) => g.group.key === "juice-bar")!;
    expect(jb.repos.map((r) => r.repoKey)).toEqual(["juice-bar", "arc-scraper"]);
    expect(jb.repos[0]!.role).toBe("primary");
    expect(jb.repos[0]!.availability).toBe("ok");
    expect(jb.repos[0]!.branches).toHaveLength(1);
    expect(jb.repos[1]!.role).toBe("dependency");
    expect(jb.repos[1]!.availability).toBe("missing");
    expect(jb.repos[1]!.branches).toEqual([]); // honest absent 0-row
    expect(() => parseGitStateV1(gs)).not.toThrow();
  });

  it("maps the BranchSignal git payload to a persisted BranchGitV1 row (no provenance envelope)", () => {
    const gs = deriveGitState(
      bundleOf([
        repoGitSignal("juice-bar"),
        branchSignal("cos/COS-1", {
          repo: "juice-bar",
          ahead: 2,
          behind: 7,
          staleDays: 20,
          statuses: ["behind", "stale", "dirty"],
          recentCommits: [{ sha: "a", subject: "x", author: "Joe", committedAt: "2026-06-23T00:00:00Z", stat: { filesChanged: 1, insertions: 2, deletions: 0 } }],
          worktrees: [{ path: "/wt", headSha: "a", detached: false, dirtyFileCount: 3 }],
        }),
      ]),
      NOW,
      TAX,
    );
    const b = gs.groups.find((g) => g.group.key === "juice-bar")!.repos[0]!.branches[0]!;
    expect(b.ahead).toBe(2);
    expect(b.behind).toBe(7);
    expect(b.recentCommits[0]!.stat).toEqual({ filesChanged: 1, insertions: 2, deletions: 0 });
    expect(b.worktrees[0]!.dirtyFileCount).toBe(3);
    expect(b.statuses).toContain("dirty");
    expect("source" in b).toBe(false); // provenance envelope dropped
    expect("confidence" in b).toBe(false);
  });

  it("sets displayPrimaryRepoKey + a misconfigured diagnostic when the primary is absent but a dependency is up", () => {
    const gs = deriveGitState(
      bundleOf([
        repoGitSignal("juice-bar", { availability: "missing", trunk: { ref: null, state: "missing" } }),
        repoGitSignal("arc-scraper"),
        branchSignal("main", { repo: "arc-scraper" }),
      ]),
      NOW,
      TAX,
    );
    const jb = gs.groups.find((g) => g.group.key === "juice-bar")!;
    expect(jb.displayPrimaryRepoKey).toBe("arc-scraper");
    expect(gs.diagnostics.some((d) => d.code === "misconfigured_project")).toBe(true);
  });

  it("surfaces a degraded repo's git-read-failed diagnostic — the repo renders, never false-clean", () => {
    const gs = deriveGitState(
      bundleOf([
        repoGitSignal("juice-bar", {
          diagnostics: [{ level: "error", code: "git_enumeration_failed", message: "boom", repo: "juice-bar", source: "branch" }],
        }),
      ]),
      NOW,
      TAX,
    );
    expect(gs.diagnostics.some((d) => d.code === "git_enumeration_failed")).toBe(true);
    expect(gs.groups.find((g) => g.group.key === "juice-bar")!.repos[0]!.availability).toBe("ok");
  });
});

const jbRepo = (gs: ReturnType<typeof deriveGitState>) =>
  gs.groups.find((g) => g.group.key === "juice-bar")!.repos[0]!;

describe("deriveGitState — PR + review join (COS-5e)", () => {
  it("attaches an open PR to its branch by head ref + joins a head-current review", () => {
    const gs = deriveGitState(
      bundleOf([
        repoGitSignal("juice-bar"),
        branchSignal("claude/COS-1/x", { repo: "juice-bar", headSha: "deadbeef" }),
        prWork(10, "claude/COS-1/x", "deadbeef", { ticketId: "COS-1" }),
        review("deadbeef", { repo: "juice-bar", prNumber: 10, verdict: "ship" }),
      ]),
      NOW,
      TAX,
    );
    const b = jbRepo(gs).branches[0]!;
    expect(b.pullRequests).toHaveLength(1);
    expect(b.pullRequests[0]!.prNumber).toBe(10);
    expect(b.pullRequests[0]!.ticketIds).toEqual(["COS-1"]);
    expect(b.pullRequests[0]!.review?.verdict).toBe("ship");
    expect(b.pullRequests[0]!.review?.current).toBe(true);
    expect(() => parseGitStateV1(gs)).not.toThrow();
  });

  it("ignores a non-pull-request-source signal carrying a stale prNumber (codex R3 pin)", () => {
    // Legacy cached slices from other sources can carry long-merged prNumber
    // fields — the source gate must keep them off branch rows AND orphans.
    const gs = deriveGitState(
      bundleOf([
        repoGitSignal("juice-bar"),
        branchSignal("claude/COS-1/x", { repo: "juice-bar", headSha: "deadbeef" }),
        prWork(77, "claude/COS-1/x", "deadbeef", { source: "spec-backlog" }),
      ]),
      NOW,
      TAX,
    );
    const repo = jbRepo(gs);
    expect(repo.branches[0]!.pullRequests).toHaveLength(0);
    expect(repo.orphanPullRequests).toHaveLength(0);
  });

  it("dedups a multi-ticket PR into one row with merged ticketIds", () => {
    const gs = deriveGitState(
      bundleOf([
        repoGitSignal("juice-bar"),
        branchSignal("multi", { repo: "juice-bar", headSha: "aaa" }),
        prWork(20, "multi", "aaa", { ticketId: "COS-1" }),
        prWork(20, "multi", "aaa", { ticketId: "COS-2" }),
      ]),
      NOW,
      TAX,
    );
    const b = jbRepo(gs).branches[0]!;
    expect(b.pullRequests).toHaveLength(1);
    expect([...b.pullRequests[0]!.ticketIds].sort()).toEqual(["COS-1", "COS-2"]);
  });

  it("surfaces an orphan PR when no local branch matches the head ref", () => {
    const gs = deriveGitState(
      bundleOf([
        repoGitSignal("juice-bar"),
        branchSignal("main", { repo: "juice-bar" }),
        prWork(30, "feature/not-local", "zzz", { ticketId: "COS-9" }),
      ]),
      NOW,
      TAX,
    );
    const repo = jbRepo(gs);
    expect(repo.branches.find((b) => b.branch === "main")!.pullRequests).toEqual([]);
    expect(repo.orphanPullRequests).toHaveLength(1);
    expect(repo.orphanPullRequests[0]!.headRef).toBe("feature/not-local");
  });

  it("prefers a head-current review over an older report for the same PR", () => {
    const gs = deriveGitState(
      bundleOf([
        repoGitSignal("juice-bar"),
        branchSignal("b", { repo: "juice-bar", headSha: "head2" }),
        prWork(40, "b", "head2", { ticketId: "COS-1" }),
        // An older report on a prior head (block) + the head-current report (ship, older timestamp).
        review("head1", { repo: "juice-bar", prNumber: 40, verdict: "block", generatedAt: "2026-06-20T00:00:00.000Z" }),
        review("head2", { repo: "juice-bar", prNumber: 40, verdict: "ship", generatedAt: "2026-06-19T00:00:00.000Z" }),
      ]),
      NOW,
      TAX,
    );
    const b = jbRepo(gs).branches[0]!;
    // head-current wins even though its generatedAt is older than the stale-head report.
    expect(b.pullRequests[0]!.review?.verdict).toBe("ship");
    expect(b.pullRequests[0]!.review?.current).toBe(true);
  });

  it("a detached branch carries no PRs; its head-ref PR becomes an orphan", () => {
    const gs = deriveGitState(
      bundleOf([
        repoGitSignal("juice-bar"),
        branchSignal(null, { repo: "juice-bar", headSha: "det" }),
        prWork(50, "somebranch", "det", { ticketId: "COS-1" }),
      ]),
      NOW,
      TAX,
    );
    const repo = jbRepo(gs);
    expect(repo.branches.find((b) => b.branch === null)!.pullRequests).toEqual([]);
    expect(repo.orphanPullRequests).toHaveLength(1);
  });
});

describe("COS-8a — PR-action statuses fold (one ladder: git + PR states)", () => {
  const jb = (gs: ReturnType<typeof deriveGitState>) =>
    gs.groups.find((g) => g.group.key === "juice-bar")!.repos.find((r) => r.repoKey === "juice-bar")!;

  it("changes-requested PR → pr_changes_requested status, warn (medium) severity, deep-link URL intact (AC-8a)", () => {
    const gs = deriveGitState(
      bundleOf([
        repoGitSignal("juice-bar"),
        branchSignal("claude/COS-1/x", { repo: "juice-bar", statuses: [] }),
        prWork(21, "claude/COS-1/x", "s21", { prReviewDecision: "changes_requested" }),
      ]),
      NOW,
      TAX,
    );
    const b = jb(gs).branches.find((x) => x.branch === "claude/COS-1/x")!;
    expect(b.statuses).toContain("pr_changes_requested");
    expect(b.attentionSeverity).toBe("medium"); // warn on the tab rail
    expect(b.pullRequests[0]!.url).toBe("https://x/pull/21"); // the GitHub deep-link
    expect(b.pullRequests[0]!.reviewDecision).toBe("changes_requested");
  });

  it("CI-red + mergeable-blocked PRs fold their statuses; review_required stays LOW (no attention spam)", () => {
    const gs = deriveGitState(
      bundleOf([
        repoGitSignal("juice-bar"),
        branchSignal("claude/A-1/ci", { repo: "juice-bar", statuses: [] }),
        branchSignal("claude/A-2/rev", { repo: "juice-bar", statuses: [] }),
        prWork(22, "claude/A-1/ci", "s22", { ciState: "fail", prMergeable: "conflicting" }),
        prWork(23, "claude/A-2/rev", "s23", { prReviewDecision: "review_required" }),
      ]),
      NOW,
      TAX,
    );
    const ci = jb(gs).branches.find((x) => x.branch === "claude/A-1/ci")!;
    expect(ci.statuses).toEqual(expect.arrayContaining(["pr_ci_failing", "pr_mergeable_blocked"]));
    expect(ci.attentionSeverity).toBe("medium");
    const rev = jb(gs).branches.find((x) => x.branch === "claude/A-2/rev")!;
    expect(rev.statuses).toContain("pr_review_required");
    expect(rev.attentionSeverity).toBe("low"); // informational, not the attention band
  });

  it("draft PRs keep CI signals but suppress review-state statuses", () => {
    const gs = deriveGitState(
      bundleOf([
        repoGitSignal("juice-bar"),
        branchSignal("claude/D-1/x", { repo: "juice-bar", statuses: [] }),
        prWork(24, "claude/D-1/x", "s24", { isDraft: true, ciState: "fail", prReviewDecision: "changes_requested" }),
      ]),
      NOW,
      TAX,
    );
    const b = jb(gs).branches.find((x) => x.branch === "claude/D-1/x")!;
    expect(b.statuses).toContain("pr_ci_failing");
    expect(b.statuses).not.toContain("pr_changes_requested");
  });
});

describe("COS-8b — recently-landed lane fold", () => {
  const jb = (gs: ReturnType<typeof deriveGitState>) =>
    gs.groups.find((g) => g.group.key === "juice-bar")!.repos.find((r) => r.repoKey === "juice-bar")!;
  const day = 24 * 60 * 60 * 1000;

  it("folds landed signals into the repo row — newest first, via + tickets carried", () => {
    const gs = deriveGitState(
      bundleOf([
        repoGitSignal("juice-bar"),
        landedPr(395, { landedAt: new Date(NOW - 2 * day).toISOString(), ticketIds: ["GD-5"] }),
        landedPr(401, { landedAt: new Date(NOW - 1 * day).toISOString(), via: "closed", ticketIds: ["SSF-07"] }),
      ]),
      NOW,
      TAX,
    );
    const landed = jb(gs).landedPullRequests;
    expect(landed.map((l) => l.prNumber)).toEqual([401, 395]);
    expect(landed[0]).toMatchObject({ via: "closed", ticketIds: ["SSF-07"] });
    expect(landed[1]).toMatchObject({ via: "merged", ticketIds: ["GD-5"] });
  });

  it("window-filters to LANDED_WINDOW_DAYS; unparseable landedAt drops out", () => {
    const gs = deriveGitState(
      bundleOf([
        repoGitSignal("juice-bar"),
        landedPr(1, { landedAt: new Date(NOW - 8 * day).toISOString() }), // outside 7d
        landedPr(2, { landedAt: "not-a-date" }),
        landedPr(3, { landedAt: new Date(NOW - 6 * day).toISOString() }),
      ]),
      NOW,
      TAX,
    );
    expect(jb(gs).landedPullRequests.map((l) => l.prNumber)).toEqual([3]);
  });

  it("a FUTURE landedAt is dropped (skewed clock must not read forever-fresh)", () => {
    const gs = deriveGitState(
      bundleOf([repoGitSignal("juice-bar"), landedPr(5, { landedAt: new Date(NOW + 2 * day).toISOString() })]),
      NOW,
      TAX,
    );
    expect(jb(gs).landedPullRequests).toEqual([]);
  });

  it("dedups by {repo, prNumber} — a doubled batch folds once", () => {
    const gs = deriveGitState(
      bundleOf([repoGitSignal("juice-bar"), landedPr(9), landedPr(9)]),
      NOW,
      TAX,
    );
    expect(jb(gs).landedPullRequests).toHaveLength(1);
  });

  it("landed signals never touch open-PR rows or the rollup cache", () => {
    const gs = deriveGitState(
      bundleOf([
        repoGitSignal("juice-bar"),
        branchSignal("cos/COS-9", { repo: "juice-bar" }),
        landedPr(9, { headRef: "cos/COS-9" }),
      ]),
      NOW,
      TAX,
    );
    const b = jb(gs).branches.find((x) => x.branch === "cos/COS-9")!;
    expect(b.pullRequests).toEqual([]);
    expect(jb(gs).orphanPullRequests).toEqual([]);
    expect(Object.keys(gs.prRollups)).toEqual([]);
  });

  it("rollup cache persists ONLY cache-worthy entries — deferred/failed rollups are omitted so they refetch (starvation fix)", () => {
    const gs = deriveGitState(
      bundleOf([
        repoGitSignal("juice-bar"),
        prWork(11, "b/fresh", "sha-11", { ciState: "pass", prMergeable: "mergeable", prRollupFresh: true, mtime: "2026-07-01T00:00:00Z" }),
        prWork(12, "b/deferred", "sha-12", { ciState: "unknown", prMergeable: "unknown", prRollupFresh: false, mtime: "2026-07-01T00:00:00Z" }),
        prWork(13, "b/stale-fallback", "sha-13", { ciState: "pass", prMergeable: "mergeable", prRollupFresh: false, mtime: "2026-07-01T00:00:00Z" }),
      ]),
      NOW,
      TAX,
    );
    // 11 persisted; 12 (deferred) and 13 (stale fallback shown under a NEW key) omitted.
    expect(Object.keys(gs.prRollups).sort()).toEqual(["juice-bar#11"]);
    expect(gs.prRollups["juice-bar#11"]).toMatchObject({ ciState: "pass", headSha: "sha-11" });
  });

  it("a pre-8b cached payload (no landedPullRequests key) parses via the zod default", () => {
    const gs = deriveGitState(bundleOf([repoGitSignal("juice-bar")]), NOW, TAX);
    const legacy = JSON.parse(JSON.stringify(gs)) as Record<string, unknown>;
    for (const g of (legacy.groups as { repos: Record<string, unknown>[] }[])) {
      for (const r of g.repos) delete r.landedPullRequests;
    }
    const parsed = parseGitStateV1(legacy);
    expect(parsed.groups.every((g) => g.repos.every((r) => Array.isArray(r.landedPullRequests) && r.landedPullRequests.length === 0))).toBe(true);
  });
});

describe("COS-8d — head-review join (branch tips)", () => {
  const jb = (gs: ReturnType<typeof deriveGitState>) =>
    gs.groups.find((g) => g.group.key === "juice-bar")!.repos.find((r) => r.repoKey === "juice-bar")!;

  it("joins a report to the branch tip by the pre-push sha rule (sha8-prefix tolerant)", () => {
    const gs = deriveGitState(
      bundleOf([
        repoGitSignal("juice-bar"),
        branchSignal("cos/COS-8", { repo: "juice-bar", headSha: "deadbeefcafe1234" }),
        review("deadbeef", { repo: "juice-bar", verdict: "ship", p0: 0, p1: 1 }), // sha8 prefix of the head
      ]),
      NOW,
      TAX,
    );
    const b = jb(gs).branches.find((x) => x.branch === "cos/COS-8")!;
    expect(b.reviewsForHead).toHaveLength(1);
    expect(b.reviewsForHead[0]).toMatchObject({ reportKind: "cannons", verdict: "ship", p0: 0, p1: 1, engines: [] });
  });

  it("a report for an OLDER tip does NOT join — a new commit honestly reads no-review", () => {
    const gs = deriveGitState(
      bundleOf([
        repoGitSignal("juice-bar"),
        branchSignal("cos/COS-8", { repo: "juice-bar", headSha: "deadbeefcafe1234" }),
        review("0011223344556677", { repo: "juice-bar", verdict: "ship" }),
      ]),
      NOW,
      TAX,
    );
    expect(jb(gs).branches.find((x) => x.branch === "cos/COS-8")!.reviewsForHead).toEqual([]);
  });

  it("one row per reportKind (newest wins), kinds sorted newest-first", () => {
    const gs = deriveGitState(
      bundleOf([
        repoGitSignal("juice-bar"),
        branchSignal("cos/COS-8", { repo: "juice-bar", headSha: "feedface00112233" }),
        review("feedface00112233", { repo: "juice-bar", reportKind: "cannons", verdict: "ship", generatedAt: "2026-06-23T10:00:00Z" }),
        review("feedface00112233", { repo: "juice-bar", reportKind: "cannons", verdict: "revise", generatedAt: "2026-06-23T12:00:00Z" }),
        review("feedface00112233", { repo: "juice-bar", reportKind: "review", verdict: "proceed", generatedAt: "2026-06-23T11:00:00Z" }),
      ]),
      NOW,
      TAX,
    );
    const rows = jb(gs).branches.find((x) => x.branch === "cos/COS-8")!.reviewsForHead;
    expect(rows.map((r) => [r.reportKind, r.verdict])).toEqual([
      ["cannons", "revise"],
      ["review", "proceed"],
    ]);
  });

  it("a pre-8d cached payload (no reviewsForHead key) parses via the zod default", () => {
    const gs = deriveGitState(
      bundleOf([repoGitSignal("juice-bar"), branchSignal("main", { repo: "juice-bar" })]),
      NOW,
      TAX,
    );
    const legacy = JSON.parse(JSON.stringify(gs)) as Record<string, unknown>;
    for (const g of (legacy.groups as { repos: { branches: Record<string, unknown>[] }[] }[])) {
      for (const r of g.repos) for (const b of r.branches) delete b.reviewsForHead;
    }
    const parsed = parseGitStateV1(legacy);
    expect(parsed.groups.every((g) => g.repos.every((r) => r.branches.every((b) => b.reviewsForHead.length === 0)))).toBe(true);
  });
});
