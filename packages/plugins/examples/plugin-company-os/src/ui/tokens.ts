/**
 * Shared design tokens for the Company OS cockpit UI.
 *
 * Single source of truth for color, radius, and type so the Board, Reports, and
 * Routines surfaces stay cohesive and theme drift can't creep in per-component.
 * Values prefer host CSS variables (so the plugin looks native inside Paperclip)
 * with oklch fallbacks, plus a Juice Bar "Deep Ocean to Chocolate" orange accent
 * (`hsl(25 95% 53%)`) as the cockpit's signature.
 */
export const tokens = {
  border: "var(--border, oklch(0.269 0 0))",
  card: "var(--card, oklch(0.205 0 0))",
  cardElevated: "var(--popover, oklch(0.23 0 0))",
  bg: "var(--background, oklch(0.145 0 0))",
  fg: "var(--foreground, oklch(0.985 0 0))",
  muted: "var(--muted-foreground, oklch(0.708 0 0))",
  secondary: "var(--secondary, oklch(0.269 0 0))",
  accent: "hsl(25 95% 53%)",
  accentSoft: "hsl(25 95% 53% / 0.14)",
  accentBorder: "hsl(25 95% 53% / 0.42)",
  radius: 12,
  radiusSm: 8,
  font: `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`,
  mono: `ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace`,
} as const;

/**
 * Semantic status colors — review verdicts, source freshness, and the generic-
 * prefix anti-pattern marker. Kept as one map so the board, reports, and routines
 * surfaces read the same hues (e.g. "ship" is the same green everywhere). oklch
 * so they sit correctly in the Deep-Ocean-to-Chocolate dark theme.
 */
export const statusColors = {
  // Review verdicts (In-review chips)
  ship: "oklch(0.72 0.17 150)",
  proceed: "oklch(0.74 0.13 195)",
  revise: "oklch(0.80 0.15 85)",
  block: "oklch(0.64 0.21 25)",
  reviewUnknown: "oklch(0.62 0.02 250)",
  // Source freshness
  live: "oklch(0.72 0.17 150)",
  cached: "oklch(0.80 0.15 85)",
  stale: "oklch(0.66 0.20 35)",
  // Anti-pattern (generic prefix / Ops)
  generic: "oklch(0.80 0.13 70)",
  danger: "oklch(0.64 0.21 25)",
  // Next-up column accent (cool slate — the calmest of the four).
  nextUp: "oklch(0.64 0.04 255)",
} as const;

/**
 * The "status spine" — each board column's accent hue, used as a chip's left
 * border so a chip reads its state at a glance even when scanned mid-row. Keyed
 * by `ColumnId`; in-progress takes the cockpit's signature orange (active work),
 * in-review teal, shipped green, next-up a calm slate.
 */
export const columnAccent = {
  next_up: statusColors.nextUp,
  in_progress: "hsl(25 95% 53%)",
  in_review: statusColors.proceed,
  shipped: statusColors.ship,
} as const satisfies Record<"next_up" | "in_progress" | "in_review" | "shipped", string>;

export const mobileMediaQuery = "(max-width: 767px)";

/** Spring-ish transition used across cockpit micro-interactions. */
export const springTransition = "transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1), background-color 160ms ease, color 160ms ease, border-color 160ms ease";

/** Cubic-bezier spring curve reused by board keyframes + transitions. */
export const springCurve = "cubic-bezier(0.2, 0.8, 0.2, 1)";
