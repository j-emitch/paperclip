import { useEffect, useSyncExternalStore } from "react";
import { DEFAULT_TAB_KEY, normalizeTabKey, type CompanyOsTabKey } from "./tabs.js";

/**
 * Active-tab store shared across the cockpit's page and route-sidebar slots.
 *
 * Both slots are mounted from the same UI bundle, so they share this module's
 * scope — a `useSyncExternalStore` subscription keeps the page tab bar and the
 * route sidebar in lockstep without prop-drilling or coupling the two trees.
 *
 * The open tab is PERSISTED to `localStorage` so a returning session lands back
 * where it left off (Home on first run). To stay hydration-safe under ANY host
 * render mode, the module starts at `DEFAULT_TAB_KEY` and NEVER touches storage
 * at import/render scope: the server snapshot is always the default, and the
 * persisted value is adopted ONCE from a client-only mount effect
 * (`usePersistedTabHydration`). So server render and first client render agree on
 * the default — no hydration mismatch — then the store settles on the persisted
 * tab. The persisted key is passed through `normalizeTabKey`, so a value saved
 * before the `reports` -> `docs` or `routines` -> `agents` rename (or any
 * stale/unknown key) resolves forward instead of onto a dead tab. All storage access is feature-detected AND
 * try/caught, so SSR (no `localStorage`), sandboxed-iframe access throws,
 * private-mode, and quota failures degrade to the default — never throw.
 */
const STORAGE_KEY = "cos.activeTab";

let activeTab: CompanyOsTabKey = DEFAULT_TAB_KEY;
let hydrated = false;
const listeners = new Set<() => void>();

/** Read + normalize the persisted tab; any storage failure degrades to the default. */
function readPersistedTab(): CompanyOsTabKey {
  try {
    if (typeof localStorage === "undefined") return DEFAULT_TAB_KEY;
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === null ? DEFAULT_TAB_KEY : normalizeTabKey(raw);
  } catch {
    return DEFAULT_TAB_KEY;
  }
}

function persistTab(key: CompanyOsTabKey): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_KEY, key);
  } catch {
    /* storage disabled / full / blocked — the in-memory value stays authoritative */
  }
}

export function setActiveTab(key: CompanyOsTabKey): void {
  if (key === activeTab) return;
  activeTab = key;
  persistTab(key);
  for (const listener of listeners) listener();
}

/**
 * URL-route preemption (COS-8f): when the page adopts a tab from URL params,
 * the persisted tab must NOT be restored over it — an explicit `?tab=` link
 * outranks "where I left off", even when the linked tab IS the default (the
 * `activeTab !== DEFAULT_TAB_KEY` guard below can't see that case). Marking
 * hydration done makes the later `hydratePersistedTab` a no-op.
 */
export function markTabHydrationPreempted(): void {
  hydrated = true;
}

/**
 * Adopt the persisted tab ONCE, client-side. Idempotent + safe to call from more
 * than one mount point; the tests drive it directly. The app shell calls it via
 * `usePersistedTabHydration`.
 */
export function hydratePersistedTab(): void {
  if (hydrated) return;
  hydrated = true;
  // Only adopt the persisted tab if the user hasn't already navigated — a click
  // in the mount window (before this effect fires) wins over restoration.
  if (activeTab !== DEFAULT_TAB_KEY) return;
  setActiveTab(readPersistedTab());
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

/** Server render always starts at the default (no storage) — keeps hydration stable. */
function getServerSnapshot(): CompanyOsTabKey {
  return DEFAULT_TAB_KEY;
}

export function useActiveTab(): [CompanyOsTabKey, (key: CompanyOsTabKey) => void] {
  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return [value, setActiveTab];
}

/**
 * Mount hook for the app shell: adopt the persisted tab once, after first paint,
 * from a client-only effect. Mounting it from both the page and the route sidebar
 * is safe — `hydratePersistedTab` runs a single time.
 */
export function usePersistedTabHydration(): void {
  useEffect(() => {
    hydratePersistedTab();
  }, []);
}
