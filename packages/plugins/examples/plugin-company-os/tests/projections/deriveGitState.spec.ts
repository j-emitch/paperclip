import { describe, expect, it } from "vitest";
import { deriveGitState } from "../../src/projections/deriveGitState.js";
import { parseGitStateV1 } from "../../src/contracts/git-state.js";
import { NOW, branchSignal, bundleOf, repoGitSignal } from "../fixtures/signals.js";
import { taxonomyFixture } from "../fixtures/taxonomy.js";

const TAX = taxonomyFixture();

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
