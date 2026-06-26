import { describe, expect, it } from "vitest";
import { branchSource } from "../../src/sources/BranchSource.js";
import { MAX_CONFLICT_CHECKS, REPO_GIT_BUDGET_MS } from "../../src/contracts/git-state.js";
import { isBranchSignal, isRepoGitSignal, type BranchSignal, type RepoGitSignal } from "../../src/contracts/signals.js";
import {
  FAIL,
  OK,
  advancingClock,
  branchLog,
  forEachRef,
  gitFixtureContext,
  worktreeBlock,
  worktreeList,
  type GitFixtureOpts,
} from "../fixtures/git.js";

const NOW = Date.parse("2026-06-23T12:00:00.000Z");
const STALE_DATE = "2026-06-03T12:00:00.000Z"; // 20 days before NOW
type Handler = GitFixtureOpts["handler"];

async function run(opts: Partial<GitFixtureOpts> & { handler: Handler }) {
  const ctx = gitFixtureContext({ now: NOW, ...opts });
  const batch = await branchSource.collect(ctx);
  return {
    batch,
    branches: batch.signals.filter(isBranchSignal) as BranchSignal[],
    repoGit: batch.signals.filter(isRepoGitSignal) as RepoGitSignal[],
  };
}

/** A standard one-branch (cos/COS-1, one dirty worktree, ahead 2 / behind 7) repo. */
function happyHandler(over: Partial<{ revList: string; mergeTree: string; dirty: string; trunkResolves: boolean }> = {}): Handler {
  const trunkResolves = over.trunkResolves ?? true;
  return (_repo, args) => {
    switch (args[0]) {
      case "rev-parse":
        return trunkResolves && args.includes("origin/main^{commit}") ? OK("trunksha") : FAIL("fatal: Needed a single revision", 128);
      case "for-each-ref":
        return OK(forEachRef([["cos/COS-1", "abc1234", STALE_DATE]]));
      case "worktree":
        return OK(worktreeList([worktreeBlock("/wt/cos", "abc1234", "cos/COS-1")]));
      case "merge-base":
        return OK("basesha");
      case "rev-list":
        return OK(over.revList ?? "7\t2"); // behind=7, ahead=2
      case "log":
        return OK(branchLog([{ sha: "abc1234", subject: "feat: x", author: "Joe", date: STALE_DATE, shortstat: "3 files changed, 40 insertions(+), 5 deletions(-)" }]));
      case "-C":
        return OK(over.dirty ?? "M a\nM b\n?? c"); // 3 dirty
      case "merge-tree":
        return OK(over.mergeTree ?? ""); // clean
      default:
        return OK("");
    }
  };
}

describe("BranchSource — happy path", () => {
  it("derives ahead/behind/staleDays/dirty/recentCommits + statuses, repoKey only (no projectKey)", async () => {
    const { branches, repoGit } = await run({ handler: happyHandler() });
    expect(repoGit).toHaveLength(1);
    expect(repoGit[0]!.availability).toBe("ok");

    expect(branches).toHaveLength(1);
    const b = branches[0]!;
    expect(b.repo).toBe("juice-bar");
    expect("projectKey" in b).toBe(false); // resolved at projection time (PF-5)
    expect(b.branch).toBe("cos/COS-1");
    expect(b.comparison).toBe("ok");
    expect(b.ahead).toBe(2);
    expect(b.behind).toBe(7);
    expect(b.staleDays).toBe(20);
    expect(b.worktrees[0]!.dirtyFileCount).toBe(3);
    expect(b.conflictsWithTrunk).toBe(false); // clean merge-tree
    expect(b.recentCommits[0]!.stat).toEqual({ filesChanged: 3, insertions: 40, deletions: 5 });
    expect(b.statuses).toEqual(expect.arrayContaining(["behind", "stale", "dirty"]));
  });

  it("predicts a conflict from merge-tree markers", async () => {
    const { branches } = await run({ handler: happyHandler({ mergeTree: "<<<<<<< ours\nx\n=======\ny\n>>>>>>> theirs" }) });
    expect(branches[0]!.conflictsWithTrunk).toBe(true);
    expect(branches[0]!.statuses).toContain("conflicting");
  });
});

describe("BranchSource — git edge cases", () => {
  it("missing trunk → comparison 'missing_trunk', ahead/behind null", async () => {
    const { branches, repoGit } = await run({ handler: happyHandler({ trunkResolves: false }) });
    expect(branches[0]!.comparison).toBe("missing_trunk");
    expect(branches[0]!.ahead).toBeNull();
    expect(branches[0]!.behind).toBeNull();
    expect(branches[0]!.statuses).toContain("comparison_unavailable");
    expect(repoGit[0]!.trunk.state).toBe("missing");
  });

  it("unrelated histories (merge-base fails) → comparison 'no_merge_base'", async () => {
    const handler: Handler = (_r, args) => (args[0] === "merge-base" ? FAIL("", 1) : happyHandler()(_r, args));
    const { branches } = await run({ handler });
    expect(branches[0]!.comparison).toBe("no_merge_base");
    expect(branches[0]!.ahead).toBeNull();
    expect(branches[0]!.conflictsWithTrunk).toBeNull();
  });

  it("a merge-base SUBPROCESS failure (not exit 1) degrades → comparison 'error' + stale freshness", async () => {
    const handler: Handler = (_r, args) =>
      args[0] === "merge-base" ? FAIL("fatal: bad object", 128) : happyHandler()(_r, args);
    const { branches, batch } = await run({ handler });
    expect(branches[0]!.comparison).toBe("error"); // a real failure, NOT a false no_merge_base
    expect(batch.repoFreshness[0]!.freshness).toBe("stale");
  });

  it("a detached worktree becomes a branch:null signal flagged orphaned", async () => {
    const handler: Handler = (_r, args) => {
      switch (args[0]) {
        case "rev-parse":
          return args.includes("origin/main^{commit}") ? OK("trunksha") : FAIL("", 128);
        case "for-each-ref":
          return OK(""); // no local branches
        case "worktree":
          return OK(worktreeList([worktreeBlock("/wt/detached", "deadbee", null)]));
        case "merge-base":
          return OK("base");
        case "rev-list":
          return OK("0\t1"); // ahead 1, behind 0
        case "log":
          return OK(branchLog([{ sha: "deadbee", subject: "wip", author: "Joe", date: STALE_DATE }]));
        case "-C":
          return OK("");
        default:
          return OK("");
      }
    };
    const { branches } = await run({ handler });
    expect(branches).toHaveLength(1);
    expect(branches[0]!.branch).toBeNull();
    expect(branches[0]!.statuses).toContain("orphaned_worktree");
  });

  it("a branch in two worktrees yields ONE signal with a 2-element worktrees[]", async () => {
    const handler: Handler = (_r, args) => {
      if (args[0] === "worktree") {
        return OK(worktreeList([worktreeBlock("/wt/a", "abc1234", "cos/COS-1"), worktreeBlock("/wt/b", "abc1234", "cos/COS-1")]));
      }
      return happyHandler()(_r, args);
    };
    const { branches } = await run({ handler });
    expect(branches).toHaveLength(1);
    expect(branches[0]!.worktrees).toHaveLength(2);
    expect(branches[0]!.worktrees.map((w) => w.path)).toEqual(["/wt/a", "/wt/b"]);
  });

  it("a worktree whose branch ref was deleted becomes a branch:null orphan row (never dropped)", async () => {
    const handler: Handler = (_r, args) => {
      switch (args[0]) {
        case "rev-parse":
          return args.includes("origin/main^{commit}") ? OK("trunksha") : FAIL("", 128);
        case "for-each-ref":
          return OK(forEachRef([["cos/COS-1", "abc1234", STALE_DATE]])); // "ghost" NOT enumerated
        case "worktree":
          return OK(
            worktreeList([
              worktreeBlock("/wt/cos", "abc1234", "cos/COS-1"),
              worktreeBlock("/wt/ghost", "deadbee", "ghost"), // branch deleted while checked out
            ]),
          );
        case "merge-base":
          return OK("base");
        case "rev-list":
          return OK("0\t1");
        default:
          return OK("");
      }
    };
    const { branches } = await run({ handler });
    expect(branches).toHaveLength(2); // cos/COS-1 + the orphaned ghost worktree
    const orphan = branches.find((b) => b.branch === null);
    expect(orphan).toBeDefined();
    expect(orphan!.statuses).toContain("orphaned_worktree");
  });

  it("per-branch git read failures degrade the repo freshness (never a silent live)", async () => {
    const handler: Handler = (_r, args) =>
      args[0] === "rev-list" ? FAIL("fatal: bad revision", 128) : happyHandler()(_r, args);
    const { branches, batch } = await run({ handler });
    expect(branches[0]!.comparison).toBe("error");
    expect(batch.repoFreshness[0]!.freshness).toBe("stale");
    expect(batch.repoFreshness[0]!.errors.length).toBeGreaterThan(0);
  });
});

describe("BranchSource — availability tri-state", () => {
  it("distinguishes a missing dir from a non-git dir", async () => {
    const handler: Handler = (repo, args) => {
      if (args[0] === "rev-parse" && args.includes("--is-inside-work-tree")) {
        return repo === "ghost-missing"
          ? FAIL("fatal: cannot change to '/x': No such file or directory", 128)
          : FAIL("fatal: not a git repository (or any of the parent directories): .git", 128);
      }
      return OK("");
    };
    const { repoGit, branches } = await run({
      repos: [
        { repo: "ghost-missing", available: false },
        { repo: "ghost-nongit", available: false },
      ],
      handler,
    });
    expect(branches).toHaveLength(0);
    expect(repoGit.find((r) => r.repo === "ghost-missing")!.availability).toBe("missing");
    expect(repoGit.find((r) => r.repo === "ghost-nongit")!.availability).toBe("non_git");
  });
});

describe("BranchSource — cost caps & degradation", () => {
  it("conflict prediction obeys MAX_CONFLICT_CHECKS (rest → null + capped diagnostic)", async () => {
    const branchRows = Array.from({ length: MAX_CONFLICT_CHECKS + 3 }, (_, i) => [`b${i}`, `sha${i}`, STALE_DATE] as const);
    const handler: Handler = (_r, args) => {
      switch (args[0]) {
        case "rev-parse":
          return args.includes("origin/main^{commit}") ? OK("trunksha") : FAIL("", 128);
        case "for-each-ref":
          return OK(forEachRef(branchRows));
        case "worktree":
          return OK("");
        case "merge-base":
          return OK("base");
        case "rev-list":
          return OK("1\t1"); // every branch ahead AND behind → conflict-eligible
        case "log":
          return OK("");
        case "merge-tree":
          return OK(""); // clean
        default:
          return OK("");
      }
    };
    const { branches, repoGit } = await run({ handler });
    expect(branches).toHaveLength(MAX_CONFLICT_CHECKS + 3);
    const evaluated = branches.filter((b) => b.conflictsWithTrunk !== null).length;
    const capped = branches.filter((b) => b.conflictsWithTrunk === null).length;
    expect(evaluated).toBe(MAX_CONFLICT_CHECKS);
    expect(capped).toBe(3);
    expect(repoGit[0]!.diagnostics.some((d) => d.code === "conflict_check_capped")).toBe(true);
    expect(branches.filter((b) => b.statuses.includes("conflict_not_evaluated"))).toHaveLength(3);
  });

  it("budget exhaustion nulls expensive fields but NEVER drops a branch row", async () => {
    const { branches, repoGit, batch } = await run({
      clock: advancingClock(NOW, REPO_GIT_BUDGET_MS),
      handler: happyHandler(),
    });
    expect(branches).toHaveLength(1); // row preserved
    expect(branches[0]!.comparison).toBe("error");
    expect(branches[0]!.ahead).toBeNull();
    expect(branches[0]!.recentCommits).toEqual([]);
    expect(branches[0]!.freshness).toBe("stale");
    expect(repoGit[0]!.diagnostics.some((d) => d.code === "git_budget_exceeded")).toBe(true);
    expect(batch.repoFreshness[0]!.errors).toEqual([]); // budget is a diagnostic, not a read error
  });

  it("cheap enumeration failure degrades to an honest 'git read failed' state (no rows, never throws)", async () => {
    const handler: Handler = (_r, args) => {
      if (args[0] === "for-each-ref") return FAIL("fatal: not a git repository", 128);
      if (args[0] === "rev-parse") return OK("trunksha");
      return OK("");
    };
    const { branches, repoGit, batch } = await run({ handler });
    expect(branches).toHaveLength(0); // no false-clean rows
    expect(repoGit).toHaveLength(1);
    expect(repoGit[0]!.diagnostics.some((d) => d.code === "git_enumeration_failed")).toBe(true);
    expect(batch.repoFreshness[0]!.freshness).toBe("stale");
  });
});
