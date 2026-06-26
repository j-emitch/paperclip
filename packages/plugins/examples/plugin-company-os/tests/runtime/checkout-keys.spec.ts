import { describe, expect, it } from "vitest";
import { buildCheckoutKeyMap, checkoutIdFromKey, type CheckoutGitRun } from "../../src/runtime/checkout-keys.js";
import { worktreeBlock, worktreeList } from "../fixtures/git.js";

describe("buildCheckoutKeyMap", () => {
  it("registers main keys + worktree pseudo-keys, skips the primary entry, covers out-of-root worktrees", async () => {
    const gitRun: CheckoutGitRun = async (cwd) => {
      if (cwd !== "/p/company") return { stdout: "", code: 128 };
      return {
        stdout: worktreeList([
          worktreeBlock("/p/company", "mainsha", "lycaon"), // primary — git lists it first → must be skipped
          worktreeBlock("/p/company/.claude/worktrees/cos-COS-1", "wtsha", "docs/COS-1"), // under-root
          worktreeBlock("/elsewhere/codex-wt", "csha", "feat/x"), // OUT-of-root (codex-cli worktree)
        ]),
        code: 0,
      };
    };
    const { absByKey, worktrees, mainRoots } = await buildCheckoutKeyMap(["/p/company"], { gitRun });

    expect(mainRoots).toEqual([{ repoKey: "company", absPath: "/p/company" }]);
    expect(absByKey.get("company")).toBe("/p/company");
    expect(worktrees).toHaveLength(2); // primary skipped → main docs index once

    const names = worktrees.map((w) => w.name).sort();
    expect(names).toEqual(["codex-wt", "cos-COS-1"]);

    const oor = worktrees.find((w) => w.name === "codex-wt")!;
    expect(absByKey.get(oor.key)).toBe("/elsewhere/codex-wt"); // out-of-root IS resolvable
    expect(oor.parentRepoKey).toBe("company");
    expect(oor.branch).toBe("feat/x");
    expect(oor.checkoutId).toBe(checkoutIdFromKey(oor.key));
    expect(oor.checkoutId.startsWith("worktree:")).toBe(true);
  });

  it("drops a duplicate-basename root with a diagnostic (PF-7) and yields one main key", async () => {
    const gitRun: CheckoutGitRun = async () => ({ stdout: "", code: 128 });
    const { mainRoots, diagnostics } = await buildCheckoutKeyMap(["/a/company", "/b/company"], { gitRun });
    expect(mainRoots).toHaveLength(1);
    expect(diagnostics.some((d) => d.code === "duplicate_basename")).toBe(true);
  });

  it("a non-git root contributes its main key but no worktrees (no throw)", async () => {
    const gitRun: CheckoutGitRun = async () => ({ stdout: "", code: 128 });
    const { absByKey, worktrees } = await buildCheckoutKeyMap(["/p/cambora"], { gitRun });
    expect(absByKey.get("cambora")).toBe("/p/cambora");
    expect(worktrees).toHaveLength(0);
  });

  it("checkoutIdFromKey derives main vs worktree", () => {
    expect(checkoutIdFromKey("company")).toBe("main");
    expect(checkoutIdFromKey("company::wt::abc123")).toBe("worktree:abc123");
  });
});
