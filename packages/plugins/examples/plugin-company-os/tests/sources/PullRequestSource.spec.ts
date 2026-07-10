import { describe, expect, it } from "vitest";
import { pullRequestSource } from "../../src/sources/PullRequestSource.js";
import { isLandedPrSignal, isWorkSignal } from "../../src/contracts/signals.js";
import { makeFixtureContext, proc, type ProcResponder } from "../fixtures/context.js";

const prJson = (prs: unknown[]): string => JSON.stringify(prs);
const rollupJson = (over: Partial<{ statusCheckRollup: unknown[]; mergeable: string }> = {}): string =>
  JSON.stringify({ statusCheckRollup: over.statusCheckRollup ?? [], mergeable: over.mergeable ?? "UNKNOWN" });

/**
 * Route the source's THREE gh calls: `pr view` (the COS-11 rollup step) → a
 * benign empty rollup, the `--state closed` list (the COS-8b landed step) → an
 * empty array, and the open `pr list` → the test's responder — each overridable.
 * Keeps the pre-rollup tests' single-responder ergonomics.
 */
function ctxWithGh(list: ProcResponder, view?: ProcResponder, landed?: ProcResponder) {
  const gh: ProcResponder = (repo, args) =>
    args[1] === "view"
      ? (view ?? (() => proc.ok(rollupJson())))(repo, args)
      : args.includes("closed")
        ? (landed ?? (() => proc.ok("[]")))(repo, args)
        : list(repo, args);
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

describe("COS-11.gh-fields rollup — bounded fetch + cache-by-change", () => {
  const openPr = (n: number, over: Record<string, unknown> = {}) => ({
    number: n,
    title: `feat(WF-${n}): x`,
    headRefName: `claude/WF-${n}/x`,
    headRefOid: `sha-${n}`,
    url: `https://gh/${n}`,
    isDraft: false,
    updatedAt: `2026-07-08T00:0${n % 10}:00Z`,
    ...over,
  });

  it("changed/uncached PR → ONE pr view; failing check + CONFLICTING fold onto the signal", async () => {
    let views = 0;
    const ctx = ctxWithGh(
      () => proc.ok(prJson([openPr(1)])),
      () => {
        views++;
        return proc.ok(
          rollupJson({
            statusCheckRollup: [
              { __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS" },
              { __typename: "CheckRun", status: "COMPLETED", conclusion: "FAILURE" },
            ],
            mergeable: "CONFLICTING",
          }),
        );
      },
    );
    const w = (await pullRequestSource.collect(ctx)).signals.filter(isWorkSignal);
    expect(views).toBe(1);
    expect(w[0]).toMatchObject({ ciState: "fail", prMergeable: "conflicting" });
  });

  it("UNCHANGED PR with a prior cache → ZERO pr view calls, cached values reused", async () => {
    let views = 0;
    const base = ctxWithGh(
      () => proc.ok(prJson([openPr(2)])),
      () => {
        views++;
        return proc.ok(rollupJson());
      },
    );
    const ctx = {
      ...base,
      prior: {
        prRollups: {
          "juice-bar#2": {
            repoKey: "juice-bar",
            prNumber: 2,
            headSha: "sha-2",
            updatedAt: "2026-07-08T00:02:00Z",
            ciState: "pass" as const,
            mergeableState: "mergeable" as const,
          },
        },
      },
    };
    const w = (await pullRequestSource.collect(ctx)).signals.filter(isWorkSignal);
    expect(views).toBe(0); // the rate contract's core assertion
    expect(w[0]).toMatchObject({ ciState: "pass", prMergeable: "mergeable" });
  });

  it("a NEW head sha invalidates the cache entry (re-fetch)", async () => {
    let views = 0;
    const base = ctxWithGh(
      () => proc.ok(prJson([openPr(3, { headRefOid: "sha-NEW" })])),
      () => {
        views++;
        return proc.ok(rollupJson({ statusCheckRollup: [{ state: "SUCCESS" }], mergeable: "MERGEABLE" }));
      },
    );
    const ctx = {
      ...base,
      prior: {
        prRollups: {
          "juice-bar#3": { repoKey: "juice-bar", prNumber: 3, headSha: "sha-3", updatedAt: "2026-07-08T00:03:00Z", ciState: "fail" as const, mergeableState: "conflicting" as const },
        },
      },
    };
    const w = (await pullRequestSource.collect(ctx)).signals.filter(isWorkSignal);
    expect(views).toBe(1);
    expect(w[0]).toMatchObject({ ciState: "pass", prMergeable: "mergeable" });
  });

  it("rate limit → gh_rate_limited error, fetching STOPS, stale cache/unknown used", async () => {
    let views = 0;
    const base = ctxWithGh(
      () => proc.ok(prJson([openPr(4), openPr(5)])),
      () => {
        views++;
        return proc.rateLimited();
      },
    );
    const ctx = {
      ...base,
      prior: {
        prRollups: {
          "juice-bar#5": { repoKey: "juice-bar", prNumber: 5, headSha: "OLD", updatedAt: "OLD", ciState: "pass" as const, mergeableState: "mergeable" as const },
        },
      },
    };
    const batch = await pullRequestSource.collect(ctx);
    expect(views).toBe(1); // stopped after the first rate-limit response
    const errors = batch.repoFreshness.flatMap((f) => f.errors.map((e) => e.code));
    expect(errors).toContain("gh_rate_limited");
    const w = batch.signals.filter(isWorkSignal);
    expect(w.find((x) => x.prNumber === 4)).toMatchObject({ ciState: "unknown" });
    expect(w.find((x) => x.prNumber === 5)).toMatchObject({ ciState: "pass" }); // stale cache beats unknown
  });

  it("MAX_ROLLUP_FETCHES bounds a big changed set; the overflow reads unknown", async () => {
    let views = 0;
    const prs = Array.from({ length: 23 }, (_, i) => openPr(100 + i));
    const ctx = ctxWithGh(
      () => proc.ok(prJson(prs)),
      () => {
        views++;
        return proc.ok(rollupJson({ statusCheckRollup: [{ state: "SUCCESS" }], mergeable: "MERGEABLE" }));
      },
    );
    const w = (await pullRequestSource.collect(ctx)).signals.filter(isWorkSignal);
    expect(views).toBe(20);
    expect(w.filter((x) => x.ciState === "pass")).toHaveLength(20);
    expect(w.filter((x) => x.ciState === "unknown")).toHaveLength(3);
  });

  it("malformed rollup JSON → parse_error, list flow unaffected", async () => {
    const base = ctxWithGh(
      () => proc.ok(prJson([openPr(6)])),
      () => proc.ok("not-json"),
    );
    const batch = await pullRequestSource.collect(base);
    const errors = batch.repoFreshness.flatMap((f) => f.errors.map((e) => e.code));
    expect(errors).toContain("parse_error");
    expect(batch.signals.filter(isWorkSignal)[0]).toMatchObject({ prNumber: 6, ciState: "unknown" });
  });
});

describe("COS-8b — landed-PR fetch", () => {
  const landedJson = JSON.stringify([
    { number: 395, title: "feat(GD-5): blast radius", url: "https://gh/395", headRefName: "claude/GD-5/x", mergedAt: "2026-07-08T10:00:00Z", closedAt: "2026-07-08T10:00:00Z" },
    { number: 401, title: "ship to prod", url: "https://gh/401", headRefName: "claude/SSF-07/claims", mergedAt: null, closedAt: "2026-07-09T09:00:00Z" },
  ]);

  it("emits ONE landed_pr signal per closed PR — merged + ff-push-closed, tickets resolved", async () => {
    const ctx = ctxWithGh(
      () => proc.ok("[]"),
      undefined,
      () => proc.ok(landedJson),
    );
    const landed = (await pullRequestSource.collect(ctx)).signals.filter(isLandedPrSignal);
    expect(landed).toHaveLength(2);
    expect(landed[0]).toMatchObject({
      kind: "landed_pr",
      prNumber: 395,
      via: "merged",
      landedAt: "2026-07-08T10:00:00Z",
      ticketIds: ["GD-5"],
      confidence: "high",
    });
    // No title scope → head-branch fallback, lower confidence.
    expect(landed[1]).toMatchObject({ prNumber: 401, via: "closed", ticketIds: ["SSF-07"], confidence: "medium" });
  });

  it("a failed landed fetch degrades WITHOUT hiding the open-PR signals", async () => {
    const ctx = ctxWithGh(
      () => proc.ok(prJson([{ number: 8, title: "feat(COS-8): x", headRefName: "cos/COS-8", headRefOid: "s", url: "u", isDraft: false, updatedAt: "t" }])),
      undefined,
      () => proc.fail(1, "boom"),
    );
    const batch = await pullRequestSource.collect(ctx);
    expect(batch.signals.filter(isWorkSignal)).toHaveLength(1);
    expect(batch.signals.filter(isLandedPrSignal)).toEqual([]);
    expect(batch.repoFreshness[0].errors.length).toBeGreaterThan(0);
  });

  it("malformed landed JSON → parse_error, no landed signals, open flow unaffected", async () => {
    const ctx = ctxWithGh(
      () => proc.ok("[]"),
      undefined,
      () => proc.ok("not json"),
    );
    const batch = await pullRequestSource.collect(ctx);
    expect(batch.signals.filter(isLandedPrSignal)).toEqual([]);
    const errors = batch.repoFreshness.flatMap((f) => f.errors.map((e) => e.code));
    expect(errors).toContain("parse_error");
  });
});
