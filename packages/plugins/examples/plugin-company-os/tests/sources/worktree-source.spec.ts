/**
 * COS-8c T1 — `WorktreeSource`: signals match git ground truth across
 * origins × dirty × trunk states; the COH squash detector (verbatim port)
 * classifies direct/squash/none/unknown; the `_purpose` Work Record parses
 * (COH-0 checkpoints flow-maps, captured on-disk shape); and the activity
 * gate evaluates ALL DIRTY first, caps at `MAX_WORKTREE_DIFFS`, and emits the
 * `worktree_diff_capped` error NAMING skipped-dirty trees.
 */

import { describe, expect, it } from "vitest";
import type { WorktreeCheckout } from "../../src/contracts/collection-context.js";
import type { WorktreeSignal } from "../../src/contracts/signals.js";
import { MAX_WORKTREE_DIFFS } from "../../src/contracts/worktree-board.js";
import { classifyOrigin, worktreeSource } from "../../src/sources/WorktreeSource.js";
import { latestCheckpoint, parsePurposeRecord } from "../../src/sources/purpose.js";
import { FIXED_NOW, makeFixtureContext, proc, type ProcResponder } from "../fixtures/context.js";

const REPO = "company";

function wt(name: string, branch: string | null): WorktreeCheckout {
  return {
    key: `${REPO}::wt::${name.padEnd(12, "0").slice(0, 12)}`,
    checkoutId: `worktree:${name}`,
    parentRepoKey: REPO,
    branch,
    name,
  };
}

const RECENT = new Date(FIXED_NOW - 2 * 86_400_000).toISOString(); // 2d old tip
const ANCIENT = new Date(FIXED_NOW - 40 * 86_400_000).toISOString(); // 40d old tip

/**
 * Scripted git per (key, argv-prefix). Defaults model a healthy worktree:
 * trunk = origin/main, clean status, recent tip, 2 ahead / 1 behind,
 * not merged, 2 changed files.
 */
function gitFor(overrides: Record<string, Record<string, ReturnType<typeof proc.ok>>> = {}): ProcResponder {
  return (repo, args) => {
    const joined = args.join(" ");
    const table = overrides[repo];
    if (table) {
      for (const [prefix, result] of Object.entries(table)) {
        if (joined.startsWith(prefix)) return result;
      }
    }
    // Repo-level defaults.
    if (joined.startsWith("rev-parse --verify --quiet origin/main^{commit}")) return proc.ok("deadbeef\n");
    if (joined.startsWith("rev-parse --verify --quiet")) return proc.fail(1);
    if (joined.startsWith("log --since=")) return proc.ok("tree-squashed-1\ntree-squashed-2\n");
    // Worktree-level defaults.
    if (joined.startsWith("rev-parse HEAD^{tree}") || /rev-parse .*\^\{tree\}/.test(joined)) return proc.ok("tree-live\n");
    if (joined.startsWith("rev-parse HEAD")) return proc.ok("abc123\n");
    if (joined.startsWith("--no-optional-locks status --porcelain")) return proc.ok("");
    if (joined.startsWith("log -1 --format=%cI")) return proc.ok(`${RECENT}\n`);
    if (joined.startsWith("rev-list --left-right --count")) return proc.ok("1\t2\n");
    if (joined.startsWith("merge-base --is-ancestor")) return proc.fail(1);
    if (joined.startsWith("merge-base origin/main HEAD")) return proc.ok("cafebabe\n");
    if (joined.startsWith("diff --name-only")) return proc.ok("src/a.ts\nsrc/b.ts\n");
    return proc.ok("");
  };
}

async function collectSignals(
  worktrees: WorktreeCheckout[],
  git: ProcResponder,
  files: Record<string, Record<string, { content: string }>> = {},
): Promise<{ signals: WorktreeSignal[]; errors: { code: string; message: string }[] }> {
  const ctx = makeFixtureContext({
    repos: [{ repo: REPO, available: true }],
    worktrees,
    git,
    files,
  });
  const batch = await worktreeSource.collect(ctx);
  const errors = batch.repoFreshness.flatMap((r) => r.errors);
  return { signals: batch.signals.filter((s): s is WorktreeSignal => s.kind === "worktree"), errors };
}

describe("WorktreeSource ground truth", () => {
  it("emits one signal per worktree with git-truth fields", async () => {
    const { signals } = await collectSignals([wt("cos-wt-a", "claude/COS-8/build")], gitFor());
    expect(signals).toHaveLength(1);
    const s = signals[0];
    expect(s.worktreeName).toBe("cos-wt-a");
    expect(s.branch).toBe("claude/COS-8/build");
    expect(s.origin).toBe("claude");
    expect(s.headSha).toBe("abc123");
    expect(s.dirtyFileCount).toBe(0);
    expect(s.behind).toBe(1);
    expect(s.ahead).toBe(2);
    expect(s.lastCommitAt).toBe(RECENT);
    expect(s.changedFiles).toEqual(["src/a.ts", "src/b.ts"]); // active → evaluated
    expect(s.mergeStatus).toBe("none");
    expect(s.purpose).toBeNull();
  });

  it("classifies origins: branch prefix first, auto-dir shape, else external", () => {
    expect(classifyOrigin("claude/OB-1/x", "anything")).toBe("claude");
    expect(classifyOrigin("codex/fix", "anything")).toBe("codex");
    expect(classifyOrigin(null, "musing-burnell-8f4cb2")).toBe("claude");
    expect(classifyOrigin("feature/x", "my-tree")).toBe("external");
  });

  it("dirty counting via --no-optional-locks porcelain", async () => {
    const tree = wt("dirty-wt", "claude/X-1/y");
    const { signals } = await collectSignals(
      [tree],
      gitFor({ [tree.key]: { "--no-optional-locks status --porcelain": proc.ok(" M a.ts\n?? b.ts\n") } }),
    );
    expect(signals[0].dirtyFileCount).toBe(2);
  });

  it("missing trunk → ahead/behind null, mergeStatus unknown, changedFiles null", async () => {
    const git: ProcResponder = (repo, args) => {
      const joined = args.join(" ");
      if (joined.startsWith("rev-parse --verify --quiet")) return proc.fail(1); // NO trunk candidate
      return gitFor()(repo, args);
    };
    const { signals } = await collectSignals([wt("no-trunk", "claude/X-1/z")], git);
    const s = signals[0];
    expect(s.ahead).toBeNull();
    expect(s.behind).toBeNull();
    expect(s.mergeStatus).toBe("unknown");
    expect(s.changedFiles).toBeNull();
  });
});

describe("COH squash detector (verbatim port parity)", () => {
  it("ancestor of trunk → direct", async () => {
    const tree = wt("merged-direct", "claude/D-1/done");
    const { signals } = await collectSignals(
      [tree],
      gitFor({ [tree.key]: { "merge-base --is-ancestor": proc.ok("") } }),
    );
    expect(signals[0].mergeStatus).toBe("direct");
  });

  it("tree-hash ∈ trunk's 150d commit trees → squash", async () => {
    const tree = wt("merged-squash", "claude/S-1/done");
    const { signals } = await collectSignals(
      [tree],
      gitFor({
        [tree.key]: {
          "rev-parse claude/S-1/done^{tree}": proc.ok("tree-squashed-2\n"),
        },
      }),
    );
    expect(signals[0].mergeStatus).toBe("squash");
  });

  it("neither → none; degraded ancestor read → unknown", async () => {
    const none = wt("unmerged", "claude/N-1/wip");
    expect((await collectSignals([none], gitFor())).signals[0].mergeStatus).toBe("none");
    const degraded = wt("degraded", "claude/N-2/wip");
    const { signals } = await collectSignals(
      [degraded],
      gitFor({ [degraded.key]: { "merge-base --is-ancestor": { stdout: "", stderr: "", code: null, timedOut: true } } }),
    );
    expect(signals[0].mergeStatus).toBe("unknown");
  });
});

describe("COH-0 _purpose Work Record", () => {
  // The CAPTURED on-disk shape (company coh-COH-4a, 2026-07-08) — flow-map checkpoints.
  const PURPOSE = `---
ticket_ids: [COH-4a]
purpose_slug: checkpoint-consume
phase: build
intended_lifespan: phase
started_at: 2026-07-01T18:35:09Z
checkpoints:
  - {session: s, runtime: claude-code, head_sha: 1c401cf0, wip: true, pushed: false, at: 2026-07-01T19:41:59Z, consumable_artifacts: [{branch: refs/coh/wip/x, files: [a.sh, b.sh]}]}
  - {session: s, runtime: claude-code, head_sha: 15bfab74, wip: true, pushed: true, at: 2026-07-01T19:33:02Z, consumable_artifacts: []}
active_handoff: null
integration_target: main
---
body ignored
`;

  it("parses scalars, ticket_ids, and flow-map checkpoints", () => {
    const p = parsePurposeRecord(PURPOSE);
    expect(p).not.toBeNull();
    expect(p!.ticketIds).toEqual(["COH-4a"]);
    expect(p!.slug).toBe("checkpoint-consume");
    expect(p!.lifespan).toBe("phase");
    expect(p!.activeHandoff).toBeNull();
    expect(p!.integrationTarget).toBe("main");
    expect(p!.checkpoints).toHaveLength(2);
    expect(p!.checkpoints[0]).toEqual({ headSha: "1c401cf0", wip: true, pushed: false, at: "2026-07-01T19:41:59Z" });
  });

  it("latestCheckpoint picks the max-at entry (the Work Record status source)", () => {
    const p = parsePurposeRecord(PURPOSE)!;
    expect(latestCheckpoint(p)?.headSha).toBe("1c401cf0");
  });

  it("the source attaches purpose from the parent repo's _purpose file", async () => {
    const tree = wt("coh-COH-4a", "claude/COH-4a/build");
    const { signals } = await collectSignals([tree], gitFor(), {
      [REPO]: { [".claude/worktrees/_purpose/coh-COH-4a.md"]: { content: PURPOSE } },
    });
    expect(signals[0].purpose?.slug).toBe("checkpoint-consume");
  });
});

describe("row 5: worktree removed mid-scan (spec §4.1)", () => {
  it("a tree whose git reads fail after enumeration DEGRADES (row present, fields null, errors recorded)", async () => {
    const gone = wt("removed-mid-scan", "claude/R-1/gone");
    const alive = wt("still-here", "claude/R-2/ok");
    const { signals, errors } = await collectSignals(
      [gone, alive],
      gitFor({
        [gone.key]: {
          // Every per-tree read fails — the dir vanished between `git worktree
          // list` (enumeration) and the scan.
          "rev-parse HEAD": proc.fail(128, "fatal: not a git repository"),
          "--no-optional-locks status --porcelain": proc.fail(128),
          "log -1 --format=%cI": proc.fail(128),
          "rev-list --left-right --count": proc.fail(128),
          "merge-base --is-ancestor": proc.fail(128),
          "rev-parse claude/R-1/gone^{tree}": proc.fail(128),
        },
      }),
    );
    // DEGRADED row — present, nulled, honest; never a silent drop.
    const degraded = signals.find((s) => s.worktreeName === "removed-mid-scan")!;
    expect(degraded).toBeDefined();
    expect(degraded.headSha).toBeNull();
    expect(degraded.dirtyFileCount).toBeNull();
    expect(degraded.mergeStatus).toBe("unknown");
    expect(errors.some((e) => e.code === "git_read_failed" && e.message.includes("removed-mid-scan"))).toBe(true);
    // The healthy sibling is unaffected.
    expect(signals.find((s) => s.worktreeName === "still-here")?.headSha).toBe("abc123");
  });

  it("a tree pruned BEFORE enumeration is a DROPPED row (absent from ctx.worktrees → no signal)", async () => {
    const { signals } = await collectSignals([wt("only-tree", "claude/R-3/solo")], gitFor());
    expect(signals).toHaveLength(1); // nothing invented for trees git no longer lists
    expect(signals.some((s) => s.worktreeName === "pruned-earlier")).toBe(false);
  });
});

describe("activity gate (spec §5.2)", () => {
  it("a stale CLEAN tree is not evaluated; a stale DIRTY tree is", async () => {
    const staleClean = wt("stale-clean", "claude/A-1/x");
    const staleDirty = wt("stale-dirty", "claude/A-2/y");
    const { signals } = await collectSignals(
      [staleClean, staleDirty],
      gitFor({
        [staleClean.key]: { "log -1 --format=%cI": proc.ok(`${ANCIENT}\n`) },
        [staleDirty.key]: {
          "log -1 --format=%cI": proc.ok(`${ANCIENT}\n`),
          "--no-optional-locks status --porcelain": proc.ok(" M x.ts\n"),
        },
      }),
    );
    const clean = signals.find((s) => s.worktreeName === "stale-clean")!;
    const dirtyS = signals.find((s) => s.worktreeName === "stale-dirty")!;
    expect(clean.changedFiles).toBeNull(); // gate skipped it
    expect(dirtyS.changedFiles).toEqual(["src/a.ts", "src/b.ts"]); // dirty always eligible
  });

  it("caps at MAX_WORKTREE_DIFFS with a worktree_diff_capped error NAMING skipped-dirty trees", async () => {
    const trees = Array.from({ length: MAX_WORKTREE_DIFFS + 1 }, (_, i) => wt(`dirty-${String(i).padStart(2, "0")}`, `claude/C-${i}/w`));
    const overrides: Record<string, Record<string, ReturnType<typeof proc.ok>>> = {};
    for (const t of trees) overrides[t.key] = { "--no-optional-locks status --porcelain": proc.ok(" M f.ts\n") };
    const { signals, errors } = await collectSignals(trees, gitFor(overrides));
    const evaluated = signals.filter((s) => s.changedFiles !== null);
    const skipped = signals.filter((s) => s.changedFiles === null);
    expect(evaluated).toHaveLength(MAX_WORKTREE_DIFFS);
    expect(skipped).toHaveLength(1);
    const cap = errors.find((e) => e.code === "worktree_diff_capped");
    expect(cap).toBeDefined();
    expect(cap!.message).toContain("SKIPPED DIRTY");
    expect(cap!.message).toContain(skipped[0].worktreeName);
  });

  it("changedFiles caps at 200 names with the truncated flag", async () => {
    const tree = wt("big-diff", "claude/B-1/big");
    const names = Array.from({ length: 250 }, (_, i) => `f${i}.ts`).join("\n");
    const { signals } = await collectSignals([tree], gitFor({ [tree.key]: { "diff --name-only": proc.ok(`${names}\n`) } }));
    expect(signals[0].changedFiles).toHaveLength(200);
    expect(signals[0].changedFilesTruncated).toBe(true);
  });
});
