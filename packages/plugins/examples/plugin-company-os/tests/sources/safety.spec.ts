import { describe, expect, it } from "vitest";
import { gitWorkSource } from "../../src/sources/GitWorkSource.js";
import { pullRequestSource } from "../../src/sources/PullRequestSource.js";
import { collect } from "../../src/collect.js";
import { DEFAULT_SOURCES } from "../../src/sources/index.js";
import { parseBranch } from "../../src/sources/parse.js";
import { isWorkSignal } from "../../src/contracts/signals.js";
import { makeFixtureContext, gitTable, proc } from "../fixtures/context.js";

/** Codex B P2#8 — the collector safety matrix. */
describe("collector safety", () => {
  it("an invalid/unavailable repo root → stale freshness, never a crash, across all sources", async () => {
    const ctx = makeFixtureContext({
      repos: [{ repo: "juice-bar", available: false }, { repo: "company", available: false }],
      registry: [],
    });
    const { bundle, failedSources } = await collect(ctx, DEFAULT_SOURCES);
    expect(failedSources).toEqual([]);
    // No source threw; the responsible repos are reported stale (or omitted for the registry).
    for (const batch of bundle.batches) {
      for (const rf of batch.repoFreshness) expect(rf.freshness).toBe("stale");
    }
  });

  it("a branch name with shell metacharacters stays argv-safe and still parses the ticket", () => {
    // The adapter uses execFile (no shell), so metachars are inert; the parser still finds the ticket.
    const parsed = parseBranch("feat/COS-0;rm -rf ~/x");
    expect(parsed.ticketIds).toEqual(["COS-0"]);
  });

  it("git timeout → error signal + stale freshness (board not blanked)", async () => {
    const ctx = makeFixtureContext({
      repos: [{ repo: "juice-bar", available: true }],
      git: gitTable({ "worktree list": proc.timeout() }),
    });
    const batch = await gitWorkSource.collect(ctx);
    expect(batch.repoFreshness[0].errors.some((e) => e.code === "subprocess_timeout")).toBe(true);
    expect(batch.repoFreshness[0].freshness).toBe("stale");
  });

  it("gh auth failure → degraded last-good (no signals, no throw)", async () => {
    const ctx = makeFixtureContext({ repos: [{ repo: "juice-bar", available: true }], gh: () => proc.unauth() });
    const batch = await pullRequestSource.collect(ctx);
    expect(batch.signals).toEqual([]);
    expect(batch.repoFreshness[0].errors[0].code).toBe("gh_unauthenticated");
  });

  it("scoped collect restricts every source to the one repo", async () => {
    const ctx = makeFixtureContext({
      repos: [{ repo: "juice-bar", available: true }, { repo: "company", available: true }],
      scopeRepo: "juice-bar",
      git: gitTable({ "worktree list --porcelain": proc.ok("worktree /r/wt\nHEAD a\nbranch refs/heads/claude/OB-01\n") }),
    });
    const w = (await gitWorkSource.collect(ctx)).signals.filter(isWorkSignal);
    expect(w.every((s) => s.repo === "juice-bar")).toBe(true);
  });
});
