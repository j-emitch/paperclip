/**
 * COS-8f T3 — `readDocFreshness`: every rung of the 5-state ladder, the typed
 * `checkout_gone` (§4.1 row 4: worktree pruned between index fetch and git
 * call), the index gate, and git-failure typing. Fixtures mirror
 * `doc-content-read.spec.ts` (a derived index + injected deps).
 */

import { describe, expect, it } from "vitest";
import { deriveDocIndex } from "../src/projections/deriveDocIndex.js";
import { makeDocId } from "../src/contracts/doc-index.js";
import { readDocFreshness, type DocGitDeps, type DocGitRun } from "../src/doc-freshness-read.js";
import { NOW, bundleOf, docSignal } from "./fixtures/signals.js";
import { taxonomyFixture } from "./fixtures/taxonomy.js";

const WT_KEY = "company::wt::aaaaaaaaaaaa";

const INDEX = deriveDocIndex(
  bundleOf([
    docSignal("specs/x.md", { repo: "company", checkoutId: "main", checkoutKey: "company" }),
    docSignal("specs/y.md", {
      repo: "company",
      checkoutId: "worktree:aaaaaaaaaaaa",
      checkoutKey: WT_KEY,
      worktreeName: "wt1",
      branch: "cos/COS-8",
    }),
  ]),
  NOW,
  taxonomyFixture(),
);

const MAIN = makeDocId("company", "main", "specs/x.md");
const WT = makeDocId("company", "worktree:aaaaaaaaaaaa", "specs/y.md");

/**
 * Scripted git: each key is the first matching prefix of the argv joined by
 * space; unmatched calls fail loudly so a test never silently green-lights an
 * unexpected git call.
 */
function scriptedGit(script: Record<string, { stdout: string; code: number | null }>): DocGitRun {
  return async (_checkoutKey, args) => {
    const joined = args.join(" ");
    for (const [prefix, result] of Object.entries(script)) {
      if (joined.startsWith(prefix)) return result;
    }
    throw new Error(`unscripted git call: ${joined}`);
  };
}

function deps(git: DocGitRun, over: Partial<DocGitDeps> = {}): DocGitDeps {
  return {
    readIndex: async () => INDEX,
    checkoutResolvable: (key) => key === "company" || key === WT_KEY,
    gitRun: git,
    ...over,
  };
}

const CLEAN = { stdout: "", code: 0 as const };

describe("readDocFreshness", () => {
  it("main-checkout copy → state main, no git calls", async () => {
    const r = await readDocFreshness(
      deps(async () => {
        throw new Error("git must not run for the main copy");
      }),
      "co",
      MAIN,
    );
    expect(r.status).toBe("ok");
    expect(r.state).toBe("main");
    expect(r.checkout).toBe("main");
  });

  it("dirty worktree copy → uncommitted", async () => {
    const r = await readDocFreshness(deps(scriptedGit({ "--no-optional-locks status --porcelain": { stdout: " M specs/y.md\n", code: 0 } })), "co", WT);
    expect(r.status).toBe("ok");
    expect(r.state).toBe("uncommitted");
    expect(r.branch).toBe("cos/COS-8");
  });

  // Shared script fragments — the merged rungs run BEFORE the upstream rungs,
  // so every not-merged scenario needs the trunk + both diffs scripted.
  const TRUNK_OK = { "rev-parse --verify --quiet origin/main^{commit}": { stdout: "deadbeef\n", code: 0 as const } };
  const DIFFERS_FROM_TIP = { "diff --name-only origin/main HEAD": { stdout: "specs/y.md\n", code: 0 as const } };
  const DIFFERS_FROM_MB = { "diff --name-only origin/main...HEAD": { stdout: "specs/y.md\n", code: 0 as const } };

  it("clean + no upstream → committed (nothing pushed yet)", async () => {
    const r = await readDocFreshness(
      deps(
        scriptedGit({
          "--no-optional-locks status --porcelain": CLEAN,
          ...TRUNK_OK,
          ...DIFFERS_FROM_TIP,
          ...DIFFERS_FROM_MB,
          "rev-parse --abbrev-ref": { stdout: "", code: 128 },
        }),
      ),
      "co",
      WT,
    );
    expect(r.state).toBe("committed");
    expect(r.message).toContain("no upstream");
  });

  it("clean + ahead of upstream on this file → committed", async () => {
    const r = await readDocFreshness(
      deps(
        scriptedGit({
          "--no-optional-locks status --porcelain": CLEAN,
          ...TRUNK_OK,
          ...DIFFERS_FROM_TIP,
          ...DIFFERS_FROM_MB,
          "rev-parse --abbrev-ref": { stdout: "origin/cos/COS-8\n", code: 0 },
          "log --oneline": { stdout: "abc123 edit doc\n", code: 0 },
        }),
      ),
      "co",
      WT,
    );
    expect(r.state).toBe("committed");
  });

  it("pushed but differing from trunk → pushed", async () => {
    const r = await readDocFreshness(
      deps(
        scriptedGit({
          "--no-optional-locks status --porcelain": CLEAN,
          ...TRUNK_OK,
          ...DIFFERS_FROM_TIP,
          ...DIFFERS_FROM_MB,
          "rev-parse --abbrev-ref": { stdout: "origin/cos/COS-8\n", code: 0 },
          "log --oneline": CLEAN,
        }),
      ),
      "co",
      WT,
    );
    expect(r.state).toBe("pushed");
  });

  it("no branch-side changes vs the merge-base → merged (trunk may have moved on)", async () => {
    // 2-dot differs (trunk tip moved the file), 3-dot empty (this copy has
    // nothing trunk lacks). NO upstream keys: reaching the upstream rung
    // would throw — proving merged is decided FIRST (the detached fix).
    const r = await readDocFreshness(
      deps(
        scriptedGit({
          "--no-optional-locks status --porcelain": CLEAN,
          ...TRUNK_OK,
          ...DIFFERS_FROM_TIP,
          "diff --name-only origin/main...HEAD": CLEAN,
        }),
      ),
      "co",
      WT,
    );
    expect(r.state).toBe("merged");
  });

  it("squash-merged: content identical to the trunk TIP → merged (2-dot proof)", async () => {
    const r = await readDocFreshness(
      deps(
        scriptedGit({
          "--no-optional-locks status --porcelain": CLEAN,
          ...TRUNK_OK,
          "diff --name-only origin/main HEAD": CLEAN,
        }),
      ),
      "co",
      WT,
    );
    expect(r.state).toBe("merged");
  });

  it("IGNORED indexed doc reads as uncommitted, not a trunk state (--ignored)", async () => {
    const r = await readDocFreshness(
      deps(scriptedGit({ "--no-optional-locks status --porcelain": { stdout: "!! specs/y.md\n", code: 0 } })),
      "co",
      WT,
    );
    expect(r.state).toBe("uncommitted");
  });

  it("no trunk ref anywhere → upstream rungs still run; pushed carries the caveat", async () => {
    const r = await readDocFreshness(
      deps(
        scriptedGit({
          "--no-optional-locks status --porcelain": CLEAN,
          "rev-parse --verify --quiet": { stdout: "", code: 1 },
          "rev-parse --abbrev-ref": { stdout: "origin/cos/COS-8\n", code: 0 },
          "log --oneline": CLEAN,
        }),
      ),
      "co",
      WT,
    );
    expect(r.state).toBe("pushed");
    expect(r.message).toContain("No trunk ref");
  });

  it("row 4: checkout pruned between index fetch and git call → typed checkout_gone", async () => {
    const r = await readDocFreshness(
      deps(
        async () => {
          throw new Error("git must not run for a gone checkout");
        },
        { checkoutResolvable: (key) => key === "company" },
      ),
      "co",
      WT,
    );
    expect(r.status).toBe("checkout_gone");
    expect(r.state).toBeNull();
  });

  it("index gate: unknown docId → not_indexed", async () => {
    const r = await readDocFreshness(deps(scriptedGit({})), "co", makeDocId("company", "main", "specs/gone.md"));
    expect(r.status).toBe("not_indexed");
  });

  it("git status failure → typed git_error, never a throw", async () => {
    const r = await readDocFreshness(deps(scriptedGit({ "--no-optional-locks status --porcelain": { stdout: "", code: 128 } })), "co", WT);
    expect(r.status).toBe("git_error");
    expect(r.state).toBeNull();
  });
});
