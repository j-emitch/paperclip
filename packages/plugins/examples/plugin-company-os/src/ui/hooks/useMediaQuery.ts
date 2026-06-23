/**
 * `useMediaQuery` / `useIsMobile` — SSR-safe `matchMedia` subscriptions shared
 * by the page shell and the board. One source of truth so the mobile breakpoint
 * can't drift between surfaces. Returns `false` when `matchMedia` is unavailable
 * (SSR / the Playwright static harness), so server markup stays the desktop layout.
 */

import { useEffect, useState } from "react";
import { mobileMediaQuery } from "../tokens.js";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const update = () => setMatches(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, [query]);
  return matches;
}

export function useIsMobile(): boolean {
  return useMediaQuery(mobileMediaQuery);
}
