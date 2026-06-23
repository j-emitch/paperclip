import { useSyncExternalStore } from "react";
import { DEFAULT_TAB_KEY, type CompanyOsTabKey } from "./tabs.js";

/**
 * Active-tab store shared across the cockpit's page and route-sidebar slots.
 *
 * Both slots are mounted from the same UI bundle, so they share this module's
 * scope — a `useSyncExternalStore` subscription keeps the page tab bar and the
 * route sidebar in lockstep without prop-drilling or coupling the two trees.
 * One source of truth for "which tab is open."
 */
let activeTab: CompanyOsTabKey = DEFAULT_TAB_KEY;
const listeners = new Set<() => void>();

export function setActiveTab(key: CompanyOsTabKey): void {
  if (key === activeTab) return;
  activeTab = key;
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
