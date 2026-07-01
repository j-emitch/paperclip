import { useSyncExternalStore } from "react";
import { DEFAULT_TAB_KEY, normalizeTabKey, type CompanyOsTabKey } from "./tabs.js";

/**
 * Active-tab store shared across the cockpit's page and route-sidebar slots.
 *
 * Both slots are mounted from the same UI bundle, so they share this module's
 * scope — a `useSyncExternalStore` subscription keeps the page tab bar and the
 * route sidebar in lockstep without prop-drilling or coupling the two trees.
 * One source of truth for "which tab is open."
 *
 * The open tab is PERSISTED to `localStorage` so a returning session lands back
 * where it left off (Home on first run). The persisted key is passed through
 * `normalizeTabKey`, so a value saved before the `reports` -> `docs` rename — or
 * any stale/unknown key — resolves forward instead of onto a dead tab. Storage
 * access is feature-detected + try/caught: SSR (no `localStorage`) and
 * privacy-mode failures degrade to the in-memory default, never throw.
 */
const STORAGE_KEY = "cos.activeTab";

function readPersistedTab(): CompanyOsTabKey {
  if (typeof localStorage === "undefined") return DEFAULT_TAB_KEY;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === null ? DEFAULT_TAB_KEY : normalizeTabKey(raw);
  } catch {
    return DEFAULT_TAB_KEY;
  }
}

function persistTab(key: CompanyOsTabKey): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, key);
  } catch {
    /* storage disabled/full — the in-memory value stays authoritative */
  }
}

let activeTab: CompanyOsTabKey = readPersistedTab();
const listeners = new Set<() => void>();

export function setActiveTab(key: CompanyOsTabKey): void {
  if (key === activeTab) return;
  activeTab = key;
  persistTab(key);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): CompanyOsTabKey {
  return activeTab;
}

export function useActiveTab(): [CompanyOsTabKey, (key: CompanyOsTabKey) => void] {
  const value = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return [value, setActiveTab];
}
