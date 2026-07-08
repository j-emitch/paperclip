/**
 * COS-8f routing — parse/print round-trip, strict-miss parsing, exact-match
 * resolution with `ck=` disambiguation, and the AC-8f#2 re-derive stability
 * anchor: the SAME URL resolves to the SAME doc before and after a forced
 * re-derive, because the params embed only durable keys (repo, checkout
 * basename, relPath, worktree hash) — never derive-time state.
 */

import { describe, expect, it } from "vitest";
import { deriveDocIndex } from "../../src/projections/deriveDocIndex.js";
import {
  ckOfEntry,
  docsRouteForEntry,
  parseCockpitSearch,
  printCockpitSearch,
  resolveDocsRoute,
  type CockpitRoute,
  type DocsRoute,
} from "../../src/ui/routing.js";
import { routeToPendingTarget } from "../../src/ui/routing-sync.js";
import { NOW, bundleOf, docSignal } from "../fixtures/signals.js";
import { taxonomyFixture } from "../fixtures/taxonomy.js";

const HASH_A = "aaaaaaaaaaaa";
const HASH_B = "bbbbbbbbbbbb";

/** Two worktrees whose dir BASENAME collides (`wt-shared`) + one main doc. */
function indexFixture() {
  return deriveDocIndex(
    bundleOf([
      docSignal("specs/x.md", { repo: "company", checkoutId: "main", checkoutKey: "company" }),
      docSignal("specs/x.md", {
        repo: "company",
        checkoutId: `worktree:${HASH_A}`,
        checkoutKey: `company::wt::${HASH_A}`,
        worktreeName: "wt-shared",
      }),
      docSignal("specs/x.md", {
        repo: "company",
        checkoutId: `worktree:${HASH_B}`,
        checkoutKey: `company::wt::${HASH_B}`,
        worktreeName: "wt-shared",
      }),
      docSignal("specs/solo.md", {
        repo: "company",
        checkoutId: `worktree:${HASH_A}`,
        checkoutKey: `company::wt::${HASH_A}`,
        worktreeName: "wt-solo",
      }),
    ]),
    NOW,
    taxonomyFixture(),
  );
}

describe("parseCockpitSearch", () => {
  it("parses a tab-only route (leading ? optional)", () => {
    expect(parseCockpitSearch("?tab=docs")).toEqual({ kind: "tab", tab: "docs" });
    expect(parseCockpitSearch("tab=agents")).toEqual({ kind: "tab", tab: "agents" });
  });

  it("resolves a legacy tab key forward, and misses an unknown one", () => {
    expect(parseCockpitSearch("?tab=reports")).toEqual({ kind: "tab", tab: "docs" });
    expect(parseCockpitSearch("?tab=nonsense")).toBeNull();
    expect(parseCockpitSearch("")).toBeNull();
    expect(parseCockpitSearch("?repo=company")).toBeNull(); // no tab= → no route
  });

  it("parses a docs route with defaulted main checkout", () => {
    expect(parseCockpitSearch("?tab=docs&repo=company&path=specs/x.md")).toEqual({
      kind: "docs",
      tab: "docs",
      repoKey: "company",
      checkout: "main",
      relPath: "specs/x.md",
      ck: null,
    });
  });

  it("rejects a malformed ck= and unsafe paths (strict miss, never a guess)", () => {
    expect(parseCockpitSearch("?tab=docs&repo=company&path=specs/x.md&ck=nothex")).toBeNull();
    expect(parseCockpitSearch("?tab=docs&repo=company&path=../etc/passwd")).toBeNull();
    expect(parseCockpitSearch("?tab=docs&repo=company&path=/abs/path.md")).toBeNull();
  });

  it("parses a worktree route", () => {
    expect(parseCockpitSearch(`?tab=branch-pr&repo=juice-bar&wt=cos-COS-8&ck=${HASH_A}`)).toEqual({
      kind: "worktree",
      tab: "branch-pr",
      repoKey: "juice-bar",
      wt: "cos-COS-8",
      ck: HASH_A,
    });
  });

  it("docs/branch-pr params missing their target degrade to tab-only", () => {
    expect(parseCockpitSearch("?tab=docs&repo=company")).toEqual({ kind: "tab", tab: "docs" });
    expect(parseCockpitSearch("?tab=branch-pr&repo=company")).toEqual({ kind: "tab", tab: "branch-pr" });
  });
});

describe("printCockpitSearch round-trip", () => {
  const routes: CockpitRoute[] = [
    { kind: "tab", tab: "home" },
    { kind: "docs", tab: "docs", repoKey: "company", checkout: "main", relPath: "specs/x.md", ck: null },
    { kind: "docs", tab: "docs", repoKey: "company", checkout: "wt-shared", relPath: "specs/x.md", ck: HASH_A },
    { kind: "worktree", tab: "branch-pr", repoKey: "juice-bar", wt: "musing-burnell", ck: null },
  ];
  it("parse(print(route)) is identity for every producible route", () => {
    for (const route of routes) {
      expect(parseCockpitSearch(printCockpitSearch(route))).toEqual(route);
    }
  });

  it("encodes path separators safely", () => {
    const route: DocsRoute = {
      kind: "docs",
      tab: "docs",
      repoKey: "company",
      checkout: "main",
      relPath: "docs/superpowers/specs/a b.md",
      ck: null,
    };
    const search = printCockpitSearch(route);
    expect(parseCockpitSearch(search)).toEqual(route);
  });
});

describe("resolveDocsRoute", () => {
  const index = indexFixture();

  it("resolves a unique (repo, checkout, path) without ck=", () => {
    const res = resolveDocsRoute(
      { kind: "docs", tab: "docs", repoKey: "company", checkout: "wt-solo", relPath: "specs/solo.md", ck: null },
      index,
    );
    expect(res.kind).toBe("resolved");
    if (res.kind === "resolved") expect(res.entry.worktreeName).toBe("wt-solo");
  });

  it("resolves main vs worktree copies of the same relPath separately", () => {
    const main = resolveDocsRoute(
      { kind: "docs", tab: "docs", repoKey: "company", checkout: "main", relPath: "specs/x.md", ck: null },
      index,
    );
    expect(main.kind).toBe("resolved");
    if (main.kind === "resolved") expect(main.entry.checkoutKey).toBe("company");
  });

  it("returns AMBIGUOUS for a basename collision without ck= (never auto-picks)", () => {
    const res = resolveDocsRoute(
      { kind: "docs", tab: "docs", repoKey: "company", checkout: "wt-shared", relPath: "specs/x.md", ck: null },
      index,
    );
    expect(res.kind).toBe("ambiguous");
    if (res.kind === "ambiguous") expect(res.candidates).toHaveLength(2);
  });

  it("ck= decides the collision", () => {
    const res = resolveDocsRoute(
      { kind: "docs", tab: "docs", repoKey: "company", checkout: "wt-shared", relPath: "specs/x.md", ck: HASH_B },
      index,
    );
    expect(res.kind).toBe("resolved");
    if (res.kind === "resolved") expect(res.entry.checkoutKey).toBe(`company::wt::${HASH_B}`);
  });

  it("misses on wrong repo/checkout/path/ck and on a null index", () => {
    const base: DocsRoute = { kind: "docs", tab: "docs", repoKey: "company", checkout: "main", relPath: "specs/x.md", ck: null };
    expect(resolveDocsRoute({ ...base, repoKey: "nope" }, index).kind).toBe("miss");
    expect(resolveDocsRoute({ ...base, relPath: "specs/gone.md" }, index).kind).toBe("miss");
    expect(resolveDocsRoute({ ...base, checkout: "wt-gone" }, index).kind).toBe("miss");
    expect(resolveDocsRoute({ ...base, ck: HASH_A }, index).kind).toBe("miss"); // main has no wt hash
    expect(resolveDocsRoute(base, null).kind).toBe("miss");
  });

  it("AC-8f#2: the SAME URL resolves to the SAME doc across a forced re-derive", () => {
    const entry = (() => {
      const res = resolveDocsRoute(
        { kind: "docs", tab: "docs", repoKey: "company", checkout: "wt-shared", relPath: "specs/x.md", ck: HASH_A },
        index,
      );
      if (res.kind !== "resolved") throw new Error("fixture must resolve");
      return res.entry;
    })();
    const url = printCockpitSearch(docsRouteForEntry(entry));

    // Force a re-derive: a fresh index object, later timestamp, reordered signals.
    const rederived = deriveDocIndex(
      bundleOf([
        docSignal("specs/solo.md", {
          repo: "company",
          checkoutId: `worktree:${HASH_A}`,
          checkoutKey: `company::wt::${HASH_A}`,
          worktreeName: "wt-solo",
        }),
        docSignal("specs/x.md", {
          repo: "company",
          checkoutId: `worktree:${HASH_B}`,
          checkoutKey: `company::wt::${HASH_B}`,
          worktreeName: "wt-shared",
        }),
        docSignal("specs/x.md", {
          repo: "company",
          checkoutId: `worktree:${HASH_A}`,
          checkoutKey: `company::wt::${HASH_A}`,
          worktreeName: "wt-shared",
        }),
        docSignal("specs/x.md", { repo: "company", checkoutId: "main", checkoutKey: "company" }),
      ]),
      NOW + 60_000, // a later derive tick
      taxonomyFixture(),
    );

    const route = parseCockpitSearch(url);
    expect(route).not.toBeNull();
    if (!route || route.kind !== "docs") throw new Error("expected docs route");
    const res = resolveDocsRoute(route, rederived);
    expect(res.kind).toBe("resolved");
    if (res.kind === "resolved") expect(res.entry.docId).toBe(entry.docId);
  });
});

describe("route helpers", () => {
  it("docsRouteForEntry always carries ck= for worktree copies, never for main", () => {
    const index = indexFixture();
    const all = index.groups.flatMap((g) => g.types.flatMap((t) => t.docs));
    for (const entry of all) {
      const route = docsRouteForEntry(entry);
      if (entry.worktreeName === null) expect(route.ck).toBeNull();
      else expect(route.ck).toBe(ckOfEntry(entry));
    }
  });

  it("routeToPendingTarget maps docs→doc-copy, worktree→worktree, tab→null", () => {
    expect(
      routeToPendingTarget({ kind: "docs", tab: "docs", repoKey: "r", checkout: "main", relPath: "a.md", ck: null }),
    ).toEqual({ tab: "doc-copy", repoKey: "r", checkout: "main", relPath: "a.md", ck: null });
    expect(routeToPendingTarget({ kind: "worktree", tab: "branch-pr", repoKey: "r", wt: "w", ck: null })).toEqual({
      tab: "worktree",
      repoKey: "r",
      wt: "w",
      ck: null,
    });
    expect(routeToPendingTarget({ kind: "tab", tab: "home" })).toBeNull();
  });
});
