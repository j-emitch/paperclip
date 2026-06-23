import { describe, expect, it } from "vitest";
import { pullRequestSource } from "../../src/sources/PullRequestSource.js";
import { isWorkSignal } from "../../src/contracts/signals.js";
import { makeFixtureContext, proc, type ProcResponder } from "../fixtures/context.js";

const prJson = (prs: unknown[]): string => JSON.stringify(prs);

function ctxWithGh(gh: ProcResponder) {
  return makeFixtureContext({ repos: [{ repo: "juice-bar", available: true }], gh });
}

describe("PullRequestSource", () => {
  it("emits an In-review chip per PR via title scope", async () => {
    const ctx = ctxWithGh(() =>
      proc.ok(
        prJson([
          { number: 310, title: "feat(SSF-02): spine", headRefName: "claude/SSF-02/x", headRefOid: "abc", url: "https://gh/310", isDraft: false, updatedAt: "t" },
        ]),
      ),
    );
    const w = (await pullRequestSource.collect(ctx)).signals.filter(isWorkSignal);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({
      ticketId: "SSF-02",
      state: "in_review",
      precedence: "pr_scope",
      prNumber: 310,
      url: "https://gh/310",
      confidence: "high",
      sha: "abc",
    });
  });

  it("falls back to the head branch when the title has no scope (lower confidence)", async () => {
    const ctx = ctxWithGh(() =>
      proc.ok(prJson([{ number: 7, title: "wip", headRefName: "feat/OB-01-foo", headRefOid: "d", url: "u", isDraft: true, updatedAt: "t" }])),
    );
    const w = (await pullRequestSource.collect(ctx)).signals.filter(isWorkSignal);
    expect(w[0]).toMatchObject({ ticketId: "OB-01", precedence: "pr_scope", confidence: "medium" });
  });

  it("multi-ticket PR fans out", async () => {
    const ctx = ctxWithGh(() =>
      proc.ok(prJson([{ number: 9, title: "fix(GAP-00, GAP-01): x", headRefName: "b", headRefOid: "d", url: "u", isDraft: false, updatedAt: "t" }])),
    );
    const ids = (await pullRequestSource.collect(ctx)).signals.filter(isWorkSignal).map((s) => s.ticketId);
    expect(ids).toEqual(["GAP-00", "GAP-01"]);
  });

  it("a PR with no parseable ticket → Unclassified", async () => {
    const ctx = ctxWithGh(() =>
      proc.ok(prJson([{ number: 1, title: "misc cleanup", headRefName: "cleanup", headRefOid: "d", url: "u", isDraft: false, updatedAt: "t" }])),
    );
    const w = (await pullRequestSource.collect(ctx)).signals.filter(isWorkSignal);
    expect(w[0]).toMatchObject({ ticketId: null, unclassifiedReason: "bad_branch_format", state: "in_review" });
  });

  it("gh unauthenticated → degraded, no signals (last-good kept upstream)", async () => {
    const ctx = ctxWithGh(() => proc.unauth());
    const batch = await pullRequestSource.collect(ctx);
    expect(batch.signals).toEqual([]);
    expect(batch.repoFreshness[0].freshness).toBe("stale");
    expect(batch.repoFreshness[0].errors[0].code).toBe("gh_unauthenticated");
  });

  it("gh rate-limited → degraded with the precise code", async () => {
    const ctx = ctxWithGh(() => proc.rateLimited());
    const batch = await pullRequestSource.collect(ctx);
    expect(batch.repoFreshness[0].errors[0].code).toBe("gh_rate_limited");
  });

  it("malformed gh JSON → parse_error, no crash", async () => {
    const ctx = ctxWithGh(() => proc.ok("not json"));
    const batch = await pullRequestSource.collect(ctx);
    expect(batch.signals).toEqual([]);
    expect(batch.repoFreshness[0].errors[0].code).toBe("parse_error");
  });
});
