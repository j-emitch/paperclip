/**
 * URL ⇄ session-state sync (COS-8f) — the React glue between the pure routing
 * module and the cockpit's two session stores (active-tab, pending-target).
 *
 * Precedence contract (plan T1): on load, URL params OUTRANK the persisted
 * tab (`markTabHydrationPreempted`); in-app route changes write back to the
 * store AND the URL; a host back/forward gesture changes `location.search`,
 * which re-runs adoption — so history traversal drives the cockpit.
 *
 * `useUrlRouteAdoption` mounts ONCE, in the page component (not the route
 * sidebar): a single adopter means a search change produces exactly one
 * store write + one pending-target set.
 */

import { useCallback, useEffect } from "react";
import { useHostLocation, useHostNavigation } from "@paperclipai/plugin-sdk/ui";
import type { DeepLink } from "../contracts/index.js";
import { markTabHydrationPreempted, setActiveTab } from "./active-tab-store.js";
import { setPendingTarget } from "./pending-target-store.js";
import { parseCockpitSearch, printCockpitSearch, type CockpitRoute } from "./routing.js";
import type { CompanyOsTabKey } from "./tabs.js";

/**
 * The last search string THIS module wrote (select-tab push or canonical
 * write-back). Adoption skips exactly that value once — our own writes already
 * updated the stores, so re-adopting them would only echo a redundant
 * pending-target set (and one wasted resolve+render) per selection. A
 * back/forward gesture always carries a DIFFERENT search, so it still adopts.
 */
let selfWrittenSearch: string | null = null;

/** The one-shot deep-link target a route carries (null for tab-only routes). */
export function routeToPendingTarget(route: CockpitRoute): DeepLink | null {
  if (route.kind === "docs") {
    return { tab: "doc-copy", repoKey: route.repoKey, checkout: route.checkout, relPath: route.relPath, ck: route.ck };
  }
  if (route.kind === "worktree") {
    return { tab: "worktree", repoKey: route.repoKey, wt: route.wt, ck: route.ck };
  }
  return null;
}

/**
 * Adopt the URL's route into session state — on mount and on every
 * `location.search` change (host router pushes, browser back/forward).
 * A search string with no valid route leaves session state alone.
 */
export function useUrlRouteAdoption(): void {
  const location = useHostLocation();
  useEffect(() => {
    if (selfWrittenSearch !== null && location.search === selfWrittenSearch) {
      selfWrittenSearch = null;
      return;
    }
    const route = parseCockpitSearch(location.search);
    if (!route) return;
    // An explicit URL wins over "where I left off" — even when it names the
    // default tab, so preempt persisted-tab hydration before setting.
    markTabHydrationPreempted();
    setActiveTab(route.tab);
    const target = routeToPendingTarget(route);
    if (target) setPendingTarget(target);
  }, [location.search]);
}

/**
 * Tab selection that writes BOTH the store and the URL (push — back/forward
 * then walks tab history). No-op navigate when the URL already shows the tab.
 */
export function useSelectTab(): (key: CompanyOsTabKey) => void {
  const location = useHostLocation();
  const { navigate } = useHostNavigation();
  return useCallback(
    (key: CompanyOsTabKey) => {
      setActiveTab(key);
      // Re-clicking the CURRENT tab must not clobber its deep-link params
      // (?tab=docs&repo=…&path=… would collapse to ?tab=docs).
      const current = parseCockpitSearch(location.search);
      if (current && current.tab === key) return;
      const search = printCockpitSearch({ kind: "tab", tab: key });
      if (location.search !== search) {
        selfWrittenSearch = search;
        navigate(`${location.pathname}${search}`);
      }
    },
    [location.pathname, location.search, navigate],
  );
}

/**
 * Canonical-URL write-back for an in-surface selection (e.g. Docs picking a
 * doc): REPLACE the current entry with the route's canonical params — the
 * address bar is always copyable, and selection churn never spams history.
 */
export function useWriteRouteToUrl(): (route: CockpitRoute) => void {
  const location = useHostLocation();
  const { navigate } = useHostNavigation();
  return useCallback(
    (route: CockpitRoute) => {
      const search = printCockpitSearch(route);
      if (location.search !== search) {
        selfWrittenSearch = search;
        navigate(`${location.pathname}${search}`, { replace: true });
      }
    },
    [location.pathname, location.search, navigate],
  );
}
