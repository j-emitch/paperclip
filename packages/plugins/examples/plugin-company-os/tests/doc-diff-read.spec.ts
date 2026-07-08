/**
 * COS-8f T3 — `readDocDiff`: diff-vs-trunk for a worktree copy (merge-base,
 * working-tree-inclusive), whole-file-new for untracked docs, unchanged
 * detection, the 256KB cap with the truncation flag, and the same typed
 * checkout_gone / not_indexed / git_error ladder as freshness.
 */

import { describe, expect, it } from "vitest";
import { deriveDocIndex } from "../src/projections/deriveDocIndex.js";
import { makeDocId } from "../src/contracts/doc-index.js";
import { readDocDiff } from "../src/doc-diff-read.js";
import type { DocGitDeps, DocGitRun } from "../src/doc-freshness-read.js";
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
    }),
  ]),
  NOW,
  taxonomyFixture(),
);

const MAIN = makeDocId("company", "main", "specs/x.md");
const WT = makeDocId("company", "worktree:aaaaaaaaaaaa", "specs/y.md");

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

const TRACKED = { stdout: "specs/y.md\n", code: 0 as const };
const DIFF_TEXT = "diff --git a/specs/y.md b/specs/y.md\n--- a/specs/y.md\n+++ b/specs/y.md\n@@ -1 +1 @@\n-old\n+new\n";

const WORKTREE_SCRIPT = {
  "ls-files --error-unmatch": TRACKED,
  "rev-parse --verify --quiet origin/main^{commit}": { stdout: "deadbeef\n", code: 0 },
  "merge-base origin/main HEAD": { stdout: "cafebabe\n", code: 0 },
  "diff --stat cafebabe": { stdout: " specs/y.md | 2 +-\n 1 file changed\n", code: 0 },
  "diff cafebabe": { stdout: DIFF_TEXT, code: 0 },
};

describe("readDocDiff", () => {
  it("worktree copy diffs vs the trunk MERGE-BASE, working-tree-inclusive", async () => {
    const r = await readDocDiff(deps(scriptedGit(WORKTREE_SCRIPT)), "co", WT);
    expect(r.status).toBe("ok");
    expect(r.kind).toBe("diff");
    expect(r.diff).toContain("+new");
    expect(r.stat).toContain("1 file changed");
    expect(r.truncated).toBe(false);
  });

  it("main copy diffs vs HEAD (uncommitted edits only) — no trunk resolution", async () => {
    const r = await readDocDiff(
      deps(
        scriptedGit({
          "ls-files --error-unmatch": { stdout: "specs/x.md\n", code: 0 },
          "diff --stat HEAD": { stdout: "", code: 0 },
          "diff HEAD": { stdout: "", code: 0 },
        }),
      ),
      "co",
      MAIN,
    );
    expect(r.status).toBe("ok");
    expect(r.kind).toBe("unchanged");
    expect(r.diff).toBeNull();
  });

  it("untracked doc → whole-file-new via --no-index (exit 1 is success)", async () => {
    const r = await readDocDiff(
      deps(
        scriptedGit({
          "ls-files --error-unmatch": { stdout: "", code: 1 },
          "diff --no-index": { stdout: "+++ b/specs/y.md\n+all new\n", code: 1 },
        }),
      ),
      "co",
      WT,
    );
    expect(r.status).toBe("ok");
    expect(r.kind).toBe("untracked_new");
    expect(r.diff).toContain("+all new");
  });

  it("caps the payload at maxBytes on a line boundary and flags truncation", async () => {
    const bigDiff = `diff --git a/specs/y.md b/specs/y.md\n${"+x".repeat(40)}\n`.repeat(200);
    const r = await readDocDiff(
      deps(scriptedGit({ ...WORKTREE_SCRIPT, "diff cafebabe": { stdout: bigDiff, code: 0 } })),
      "co",
      WT,
      2048,
    );
    expect(r.status).toBe("ok");
    expect(r.truncated).toBe(true);
    expect(Buffer.byteLength(r.diff ?? "", "utf8")).toBeLessThanOrEqual(2048);
    expect(r.diff?.endsWith("\n")).toBe(true); // never a torn line
  });

  it("row 4: pruned checkout → typed checkout_gone", async () => {
    const r = await readDocDiff(
      deps(
        async () => {
          throw new Error("git must not run");
        },
        { checkoutResolvable: (key) => key === "company" },
      ),
      "co",
      WT,
    );
    expect(r.status).toBe("checkout_gone");
    expect(r.kind).toBeNull();
  });

  it("index gate + git-failure typing", async () => {
    expect((await readDocDiff(deps(scriptedGit({})), "co", makeDocId("company", "main", "nope.md"))).status).toBe("not_indexed");
    const err = await readDocDiff(
      deps(scriptedGit({ "ls-files --error-unmatch": TRACKED, "rev-parse --verify --quiet origin/main^{commit}": { stdout: "x\n", code: 0 }, "merge-base origin/main HEAD": { stdout: "", code: 128 } })),
      "co",
      WT,
    );
    expect(err.status).toBe("git_error");
  });
});
