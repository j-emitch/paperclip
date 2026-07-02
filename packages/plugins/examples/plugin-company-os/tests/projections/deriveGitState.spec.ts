import { describe, expect, it } from "vitest";
import { deriveGitState } from "../../src/projections/deriveGitState.js";
import { parseGitStateV1 } from "../../src/contracts/git-state.js";
import { NOW, branchSignal, bundleOf, repoGitSignal, review, work } from "../fixtures/signals.js";
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
