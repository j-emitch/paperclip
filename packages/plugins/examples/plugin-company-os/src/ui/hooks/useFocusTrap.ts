/**
 * `useFocusTrap` — accessible modal focus management for a dialog/drawer (codex A).
 * When `active`, it: moves focus into the container (the first focusable), traps
 * Tab/Shift+Tab within it, calls `onEscape` on Escape, and RESTORES focus to the
 * previously-focused element on deactivate. Returns a ref to place on the dialog
 * container. SSR-safe — all DOM work is inside the effect, so the pure view that
 * receives the ref still renders identically under the Playwright harness.
 */

import { useEffect, useRef } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useFocusTrap<T extends HTMLElement>(active: boolean, onEscape?: () => void) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    if (!active) return;
    const container = ref.current;
    if (!container) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusables = (): HTMLElement[] =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);

    focusables()[0]?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onEscape?.();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const activeEl = document.activeElement;
      if (e.shiftKey && (activeEl === first || !container.contains(activeEl))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (activeEl === last || !container.contains(activeEl))) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previouslyFocused?.focus?.();
    };
  }, [active, onEscape]);
  return ref;
}
