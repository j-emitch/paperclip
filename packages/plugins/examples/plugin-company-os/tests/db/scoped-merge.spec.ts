import { describe, expect, it } from "vitest";
import { bundleToSourceVersions, mergeScopedBundle, type SourceVersion } from "../../src/db/scoped-merge.js";
import { isWorkSignal } from "../../src/contracts/signals.js";
import type { SignalBundle } from "../../src/contracts/WorkSignalSource.js";
import { NOW, bundleOfBatches, work } from "../fixtures/signals.js";

function freshScoped(): SignalBundle {
  // A scoped refresh of juice-bar: only juice-bar signals + freshness.
  return bundleOfBatches([
    {
      source: "git-work",
      collectedAt: NOW,
      signals: [work("OB-01", "in_progress", "branch_path", { repo: "juice-bar" })],
      repoFreshness: [{ repo: "juice-bar", freshness: "live", lastOkAt: "t", errors: [] }],
    },
  ]);
}

const LAST_GOOD: SourceVersion[] = [
  { source: "git-work", repo: "company", signals: [work("COS-0", "in_progress", "branch_path", { repo: "company" })], freshness: "live", lastOkAt: "t0" },
  { source: "git-work", repo: "arc-scraper", signals: [work("LDI-17", "shipped", "commit_scope", { repo: "arc-scraper", sha: "x" })], freshness: "live", lastOkAt: "t0" },
  { source: "git-work", repo: "juice-bar", signals: [work("OLD-1", "in_progress", "branch_path", { repo: "juice-bar" })], freshness: "stale", lastOkAt: null },
];

describe("mergeScopedBundle", () => {
  it("full sweep (scopeRepo null) returns the fresh bundle unchanged", () => {
    const fresh = freshScoped();
    expect(mergeScopedBundle(fresh, LAST_GOOD, null)).toBe(fresh);
  });

  it("scoped refresh keeps fresh scoped-repo signals + last-good of OTHER repos, drops stale scoped last-good", () => {
    const merged = mergeScopedBundle(freshScoped(), LAST_GOOD, "juice-bar");
    const ids = merged.batches.flatMap((b) => b.signals).filter(isWorkSignal).map((s) => s.ticketId);
    // Fresh juice-bar (OB-01) replaces the stale juice-bar last-good (OLD-1 dropped),
    // and the other repos' last-good (COS-0, LDI-17) are preserved.
    expect(ids.sort()).toEqual(["COS-0", "LDI-17", "OB-01"]);
    expect(ids).not.toContain("OLD-1");
  });

  it("preserves other-repo freshness rows in the merged batch", () => {
    const merged = mergeScopedBundle(freshScoped(), LAST_GOOD, "juice-bar");
    const repos = merged.batches[0].repoFreshness.map((r) => r.repo).sort();
    expect(repos).toEqual(["arc-scraper", "company", "juice-bar"]);
  });
});

describe("bundleToSourceVersions", () => {
  it("flattens a bundle into per-(source, repo) slices, incl. zero-signal clean reads", () => {
    const bundle = bundleOfBatches([
      {
        source: "pull-request",
        collectedAt: NOW,
        signals: [work("OB-01", "in_review", "pr_scope", { repo: "juice-bar" })],
        repoFreshness: [
          { repo: "juice-bar", freshness: "live", lastOkAt: "t", errors: [] },
          { repo: "company", freshness: "live", lastOkAt: "t", errors: [] }, // clean read, no PRs
        ],
      },
    ]);
    const versions = bundleToSourceVersions(bundle);
    const byRepo = Object.fromEntries(versions.map((v) => [v.repo, v]));
    expect(byRepo["juice-bar"].signals).toHaveLength(1);
    expect(byRepo["company"].signals).toHaveLength(0); // empty slice still persisted
    expect(byRepo["company"].freshness).toBe("live");
  });
});
