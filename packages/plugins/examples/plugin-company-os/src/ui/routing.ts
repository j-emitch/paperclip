/**
 * Cockpit URL routing (COS-8f) — parse/print the shareable search-param scheme
 * and resolve doc routes against the fetched `DocIndexV1`. The URL is the
 * durable address; everything else (active-tab store, pending-target store) is
 * session state that the URL takes PRECEDENCE over on load.
 *
 * Scheme (omnibus spec §5.1 / §8):
 *   ?tab=<tabKey>                                        — tab-only
 *   ?tab=docs&repo=<repoKey>&checkout=<name>&path=<rel>[&ck=<hash12>]
 *   ?tab=branch-pr&repo=<repoKey>&wt=<basename>[&ck=<hash12>]
 *
 * Invariants:
 *   - KEY-ONLY: params carry repoKeys, checkout basenames, and repo-relative
 *     paths — never absolute paths (spec §3.3). `checkout` is the worktree dir
 *     basename with the literal `main` naming the primary checkout.
 *   - `ck=` is the 12-char worktree hash lifted from the entry's `checkoutKey`
 *     (`${repoKey}::wt::${hash12}`); it disambiguates basename collisions.
 *     In-app links ALWAYS emit it for worktree copies so a link outlives a
 *     basename collision appearing later.
 *   - Resolution is EXACT-MATCH against the index — an unresolved or ambiguous
 *     route is a typed miss/ambiguity for the UI to surface, NEVER a raw read
 *     and never an auto-pick.
 */

import type { DocEntryV1, DocIndexV1 } from "../contracts/doc-index.js";
import { resolveTabKey, type CompanyOsTabKey } from "./tabs.js";

/** The literal `checkout=` value naming a repo's primary checkout. */
export const MAIN_CHECKOUT_NAME = "main" as const;

export interface TabRoute {
  kind: "tab";
  tab: CompanyOsTabKey;
}

/** A durable link to one doc copy (worktree- or main-checkout). */
export interface DocsRoute {
  kind: "docs";
  tab: "docs";
  repoKey: string;
  /** Worktree dir basename, or `main` for the primary checkout. */
  checkout: string;
  /** Checkout-root-relative path. */
  relPath: string;
  /** 12-char worktree hash disambiguator (null for main / legacy links). */
  ck: string | null;
}

/** A durable link to one worktree card on the Branch·PR board (COS-8c). */
export interface WorktreeRoute {
  kind: "worktree";
  tab: "branch-pr";
  repoKey: string;
  /** Worktree dir basename. */
  wt: string;
  ck: string | null;
}

export type CockpitRoute = TabRoute | DocsRoute | WorktreeRoute;

/** Resolution outcome for a `DocsRoute` against the doc index. */
export type DocsRouteResolution =
  | { kind: "resolved"; entry: DocEntryV1 }
  | { kind: "ambiguous"; candidates: DocEntryV1[] }
  | { kind: "miss" };

const CK_RE = /^[0-9a-f]{12}$/;

/**
 * Lift the 12-char worktree hash out of an entry's `checkoutKey`
 * (`${repoKey}::wt::${hash12}`); `null` for a main-checkout entry.
 */
export function ckOfEntry(entry: Pick<DocEntryV1, "checkoutKey">): string | null {
  const at = entry.checkoutKey.indexOf("::wt::");
  if (at === -1) return null;
  const hash = entry.checkoutKey.slice(at + "::wt::".length);
  // A malformed suffix must NOT leak into a URL: `parseCockpitSearch` rejects
  // any `ck=` failing CK_RE, so printing it would break the round-trip anchor
  // (and could carry cache garbage). Degrade to a ck-less link instead.
  return CK_RE.test(hash) ? hash : null;
}

/** The `checkout=` value for an entry: worktree basename, or `main`. */
export function checkoutNameOfEntry(entry: Pick<DocEntryV1, "worktreeName">): string {
  return entry.worktreeName ?? MAIN_CHECKOUT_NAME;
}

/**
 * Parse the host search string into a cockpit route. Returns `null` only when
 * the route is structurally INVALID (missing/unknown `tab=`, a malformed
 * `ck=`, an absolute or `..` path) — the caller treats that as "no route in
 * the URL". Docs/worktree params that are merely INCOMPLETE (e.g. `repo=`
 * without `path=`) degrade to the tab-only route: the tab is still a valid
 * destination even when the deep-link half is unusable. A docs/worktree miss
 * is only computed AFTER a structurally valid route resolves against the index.
 */
export function parseCockpitSearch(search: string): CockpitRoute | null {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const rawTab = params.get("tab");
  if (rawTab === null || rawTab === "") return null;
  const tab = resolveTabKey(rawTab);
  if (tab === null) return null;

  const ckRaw = params.get("ck");
  if (ckRaw !== null && !CK_RE.test(ckRaw)) return null;
  const ck = ckRaw;

  if (tab === "docs") {
    const repoKey = params.get("repo");
    const relPath = params.get("path");
    const checkout = params.get("checkout") ?? MAIN_CHECKOUT_NAME;
    if (repoKey && relPath) {
      if (relPath.startsWith("/") || relPath.includes("..")) return null;
      return { kind: "docs", tab: "docs", repoKey, checkout, relPath, ck };
    }
    return { kind: "tab", tab };
  }

  if (tab === "branch-pr") {
    const repoKey = params.get("repo");
    const wt = params.get("wt");
    if (repoKey && wt) return { kind: "worktree", tab: "branch-pr", repoKey, wt, ck };
    return { kind: "tab", tab };
  }

  return { kind: "tab", tab };
}

/**
 * Print a route as its CANONICAL search string (leading `?`, fixed param
 * order) — the round-trip anchor: `parseCockpitSearch(printCockpitSearch(r))`
 * is identity for every route this module can produce.
 */
export function printCockpitSearch(route: CockpitRoute): string {
  const params = new URLSearchParams();
  params.set("tab", route.tab);
  if (route.kind === "docs") {
    params.set("repo", route.repoKey);
    params.set("checkout", route.checkout);
    params.set("path", route.relPath);
    if (route.ck) params.set("ck", route.ck);
  } else if (route.kind === "worktree") {
    params.set("repo", route.repoKey);
    params.set("wt", route.wt);
    if (route.ck) params.set("ck", route.ck);
  }
  return `?${params.toString()}`;
}

/** The canonical docs route for an index entry (copy-link / write-back). */
export function docsRouteForEntry(entry: DocEntryV1): DocsRoute {
  return {
    kind: "docs",
    tab: "docs",
    repoKey: entry.repoKey,
    checkout: checkoutNameOfEntry(entry),
    relPath: entry.relPath,
    ck: ckOfEntry(entry),
  };
}

/**
 * Resolve a docs route against the fetched index — EXACT match on
 * (repoKey, checkout name, relPath), then `ck=` narrows basename collisions.
 * One candidate → resolved; several without a deciding `ck=` → ambiguous
 * (the UI lists candidates, never auto-picks); none → miss.
 */
export function resolveDocsRoute(route: DocsRoute, index: DocIndexV1 | null): DocsRouteResolution {
  if (!index) return { kind: "miss" };
  const candidates: DocEntryV1[] = [];
  for (const group of index.groups) {
    for (const bucket of group.types) {
      for (const doc of bucket.docs) {
        if (doc.repoKey !== route.repoKey) continue;
        if (doc.relPath !== route.relPath) continue;
        if (checkoutNameOfEntry(doc) !== route.checkout) continue;
        candidates.push(doc);
      }
    }
  }
  if (route.ck !== null) {
    const narrowed = candidates.filter((doc) => ckOfEntry(doc) === route.ck);
    if (narrowed.length === 1) return { kind: "resolved", entry: narrowed[0] };
    return { kind: "miss" };
  }
  if (candidates.length === 1) return { kind: "resolved", entry: candidates[0] };
  if (candidates.length > 1) return { kind: "ambiguous", candidates };
  return { kind: "miss" };
}
