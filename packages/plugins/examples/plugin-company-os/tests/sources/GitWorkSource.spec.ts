import { describe, expect, it } from "vitest";
import { gitWorkSource } from "../../src/sources/GitWorkSource.js";
import { isWorkSignal, type Signal, type WorkSignal } from "../../src/contracts/signals.js";
import { makeFixtureContext, gitTable, proc } from "../fixtures/context.js";

const WORKTREES = [
  "worktree /repo/main",
  "HEAD aaa0000",
  "branch refs/heads/main",
  "",
  "worktree /repo/.claude/worktrees/claude-cos",
  "HEAD bbb1111",
  "branch refs/heads/claude/COS-0",
  "",
  "worktree /repo/.claude/worktrees/random-wt",
  "HEAD ccc2222",
  "branch refs/heads/random",
  "",
].join("\n");

// Records are sha · committer-date (%cI) · subject · body, RS/US separated.
const SHIPPED_LOG =
  `m1\x1f2026-05-01T00:00:00Z\x1ffeat(OB-01): step engine (#5)\x1f\x1e` +
  `m2\x1f2026-05-02T00:00:00Z\x1fRevert "feat(GU-07): orphan sweep"\x1fThis reverts commit deadbeef.\x1e` +
  `m3\x1f2026-05-03T00:00:00Z\x1ffix(GAP-00, GAP-01): dedupe\x1f\x1e`;

function workSignals(signals: readonly Signal[]): WorkSignal[] {
  return signals.filter(isWorkSignal);
}

function collectGit(scopeRepo: string | null = "juice-bar") {
  const ctx = makeFixtureContext({
    repos: [{ repo: "juice-bar", available: true }],
    scopeRepo,
    files: {
      "juice-bar": {
        "_purpose/random-wt.md": { content: "---\nticket: IMPRV-14\n---\nsweep notes" },
      },
    },
    git: gitTable({
      "worktree list --porcelain": proc.ok(WORKTREES),
      "log -1 --format=%s bbb1111": proc.ok("feat(COS-0c): collectors wip"),
      "log -1 --format=%s ccc2222": proc.ok("chore: scratch"),
      "log --first-parent": proc.ok(SHIPPED_LOG),
    }),
  });
  return gitWorkSource.collect(ctx);
}

describe("GitWorkSource — in-progress", () => {
  it("emits a branch_path candidate for a parseable branch", async () => {
    const batch = await collectGit();
    const w = workSignals(batch.signals);
    const cos0 = w.find((s) => s.ticketId === "COS-0" && s.precedence === "branch_path");
    expect(cos0).toMatchObject({ state: "in_progress", prefix: "COS", confidence: "high" });
  });

  it("emits a lower-precedence commit_scope candidate from the worktree HEAD subject", async () => {
    const w = workSignals((await collectGit()).signals);
    const cs = w.find((s) => s.ticketId === "COS-0c" && s.precedence === "commit_scope");
    expect(cs).toMatchObject({ state: "in_progress", confidence: "medium", sha: "bbb1111" });
  });

  it("emits a worktree_meta last-resort candidate from _purpose frontmatter", async () => {
    const w = workSignals((await collectGit()).signals);
    const meta = w.find((s) => s.precedence === "worktree_meta");
    expect(meta).toMatchObject({ ticketId: "IMPRV-14", confidence: "low", freshness: "stale" });
  });

  it("a non-conforming branch → Unclassified (bad_branch_format)", async () => {
    const w = workSignals((await collectGit()).signals);
    const bad = w.find((s) => s.precedence === "none" && s.evidence === "random");
    expect(bad).toMatchObject({ ticketId: null, state: "in_progress", unclassifiedReason: "bad_branch_format" });
  });

  it("ignores the main worktree (base branch — not in progress)", async () => {
    const w = workSignals((await collectGit()).signals);
    expect(w.some((s) => s.evidence === "main")).toBe(false);
  });
});

describe("GitWorkSource — shipped", () => {
  it("extracts scope + multi-ticket fanout, and un-ships reverts", async () => {
    const w = workSignals((await collectGit()).signals).filter((s) => s.state === "shipped");
    const ob = w.find((s) => s.ticketId === "OB-01");
    expect(ob).toMatchObject({ state: "shipped", reverted: false, sha: "m1" });

    const gap = w.filter((s) => s.ticketId?.startsWith("GAP-")).map((s) => s.ticketId);
    expect(gap).toEqual(["GAP-00", "GAP-01"]);

    const revert = w.find((s) => s.ticketId === "GU-07");
    expect(revert).toMatchObject({ reverted: true });
  });

  it("ships a true merge commit via the branch in its subject (no scope/trailer)", async () => {
    const ctx = makeFixtureContext({
      repos: [{ repo: "juice-bar", available: true }],
      git: gitTable({
        "worktree list --porcelain": proc.ok("worktree /r/main\nHEAD a\nbranch refs/heads/main\n"),
        "log --first-parent": proc.ok(
          `mm\x1f2026-05-01T00:00:00Z\x1fMerge pull request #5 from j-emitch/feat/OB-01-step\x1f\x1e`,
        ),
      }),
    });
    const w = workSignals((await gitWorkSource.collect(ctx)).signals).filter((s) => s.state === "shipped");
    expect(w.find((s) => s.ticketId === "OB-01")).toMatchObject({ precedence: "branch_path", sha: "mm" });
  });

  it("falls through base candidates when origin/main is absent", async () => {
    const ctx = makeFixtureContext({
      repos: [{ repo: "juice-bar", available: true }],
      git: gitTable({
        "worktree list --porcelain": proc.ok("worktree /repo/main\nHEAD a\nbranch refs/heads/main\n"),
        "log --first-parent --format=%H%x1f%cI%x1f%s%x1f%b%x1e -n 400 origin/main": proc.fail(128, "unknown revision"),
        "log --first-parent --format=%H%x1f%cI%x1f%s%x1f%b%x1e -n 400 main": proc.ok(`m9\x1f2026-05-01T00:00:00Z\x1ffeat(TAP-02): overview\x1f\x1e`),
      }),
    });
    const w = (await gitWorkSource.collect(ctx)).signals.filter(isWorkSignal);
    expect(w.find((s) => s.state === "shipped")?.ticketId).toBe("TAP-02");
  });
});

describe("GitWorkSource — degradation", () => {
  it("unavailable repo → stale freshness, no crash, no signals", async () => {
    const ctx = makeFixtureContext({ repos: [{ repo: "juice-bar", available: false }] });
    const batch = await gitWorkSource.collect(ctx);
    expect(batch.signals).toEqual([]);
    expect(batch.repoFreshness[0]).toMatchObject({ repo: "juice-bar", freshness: "stale" });
    expect(batch.repoFreshness[0].errors[0].code).toBe("repo_unavailable");
  });

  it("git failure → stale freshness recorded, board not blanked", async () => {
    const ctx = makeFixtureContext({
      repos: [{ repo: "juice-bar", available: true }],
      git: gitTable({ "worktree list": proc.timeout() }),
    });
    const batch = await gitWorkSource.collect(ctx);
    expect(batch.repoFreshness[0].freshness).toBe("stale");
    expect(batch.repoFreshness[0].errors.some((e) => e.code === "subprocess_timeout")).toBe(true);
  });
});
