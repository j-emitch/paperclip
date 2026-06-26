/**
 * The cockpit's "pending navigation target" — a one-shot `DeepLink` set when a
 * Home deep-link is followed, and CONSUMED (read + cleared) by the destination
 * surface on its next render: Docs selects the `docId`, Source expands + scrolls
 * to the branch. This decouples the source of a deep-link from its consumer
 * without prop-drilling across tabs (the same `useSyncExternalStore` idiom as
 * `active-tab-store`), so "Open X in Source/Docs" actually lands on X — not just
 * the right tab (codex B).
 */

import { useSyncExternalStore } from "react";
import type { DeepLink } from "../contracts/index.js";

let pendingTarget: DeepLink | null = null;
const listeners = new Set<() => void>();

export function setPendingTarget(target: DeepLink | null): void {
  if (target === pendingTarget) return;
  pendingTarget = target;
  for (const listener of listeners) listener();
}

/** Clear the pending target IF it is still the one a consumer just applied. */
export function clearPendingTarget(applied: DeepLink): void {
  if (pendingTarget === applied) setPendingTarget(null);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): DeepLink | null {
  return pendingTarget;
}

export function usePendingTarget(): DeepLink | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
