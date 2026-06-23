/**
 * `useNow` — a ticking clock so relative-times ("4m ago") and the board-level
 * stale badge (>5 min) keep advancing while the cockpit sits open, instead of
 * freezing at the timestamp of the last React re-render. SSR-safe: the initial
 * value is read synchronously and the interval only starts in an effect, so the
 * pure view (which takes `now` as a prop) stays deterministic under test.
 */

import { useEffect, useState } from "react";

export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
