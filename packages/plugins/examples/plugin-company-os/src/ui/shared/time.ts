/**
 * Pure time + size formatting shared by every cockpit surface (Board, Reports,
 * Routines). Kept in one place so "3h ago" reads identically everywhere and the
 * board view-model, the reports list, and the routines SLO panel cannot drift on
 * how they phrase freshness. Pure functions of an ISO string + an injected `now`
 * — no `Date.now()`, so they're deterministic under test and SSR.
 */

/**
 * Compact PAST relative-time label ("just now", "4m ago", "3h ago", "2d ago")
 * from an ISO timestamp. `null`/unparseable → null so the caller can omit the
 * element. Clamps future timestamps (clock skew) to "just now".
 */
export function relativeTime(iso: string | null, now: number): string | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  const deltaMs = Math.max(0, now - then);
  const mins = Math.floor(deltaMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Signed relative-time label that names both directions — "in 3h" for a future
 * instant, "3h ago" for a past one ("now" within a minute). Used by the shared
 * `RoutineSloCard` for the next-expected-run countdown. `null`/unparseable → null.
 */
export function relativeFromNow(iso: string | null, now: number): string | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  const deltaMs = then - now;
  const absMins = Math.floor(Math.abs(deltaMs) / 60_000);
  if (absMins < 1) return "now";
  const unit = magnitude(absMins);
  return deltaMs >= 0 ? `in ${unit}` : `${unit} ago`;
}

function magnitude(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/**
 * Parse an ISO timestamp to epoch-ms for SORTING — a malformed/empty string
 * collapses to `-Infinity` (sorts oldest-last under a `b - a` descending compare)
 * instead of `NaN`, which would make `Array.sort` order non-deterministic. Use
 * this anywhere a contract timestamp feeds a comparator.
 */
export function safeTime(iso: string | null | undefined): number {
  if (!iso) return -Infinity;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? -Infinity : t;
}

/** Human file size ("just now"-style brevity): "812 B", "4.2 KB", "1.1 MB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}
