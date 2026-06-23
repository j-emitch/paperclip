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

export const mobileMediaQuery = "(max-width: 767px)";

/** Spring-ish transition used across cockpit micro-interactions. */
export const springTransition = "transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1), background-color 160ms ease, color 160ms ease, border-color 160ms ease";
