/**
 * One scoped stylesheet for the Home surface — the things inline styles can't
 * express: the staggered panel/card entrance, the interactive hover lift on
 * clickable tiles + rows, the briefing-drawer slide-in, and the alert-rail
 * pulse on the highest-severity dot. ALL motion is suppressed under
 * `prefers-reduced-motion`, so the reduced-motion viewport is genuinely still.
 * Rendered once at the root of `HomeView`, so it's identical under SSR (the
 * Playwright harness) and live. Trusted local constant — the only interpolation
 * is design tokens.
 */

import { tokens, statusColors } from "../tokens.js";
import { withAlpha } from "../shared/color.js";

export const HOME_STYLE_ID = "cos-home-styles";

const CSS = `
@keyframes cos-home-rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
@keyframes cos-home-drawer-in { from { opacity: 0; transform: translateX(24px); } to { opacity: 1; transform: none; } }
@keyframes cos-home-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes cos-home-pulse { 0%, 100% { box-shadow: 0 0 0 0 ${withAlpha(statusColors.danger, 0.5)}; } 50% { box-shadow: 0 0 0 4px ${withAlpha(statusColors.danger, 0)}; } }

.cos-home-enter { animation: cos-home-rise 460ms cubic-bezier(0.2, 0.8, 0.2, 1) both; }

.cos-home-card {
  transition: transform 180ms cubic-bezier(0.2,0.8,0.2,1), border-color 160ms ease, background-color 160ms ease, box-shadow 200ms ease;
}
@media (hover: hover) {
  .cos-home-card:hover { border-color: ${tokens.accentBorder}; transform: translateY(-2px); box-shadow: 0 8px 24px -16px rgba(0,0,0,0.55); }
}
.cos-home-card:focus-visible { outline: 2px solid ${tokens.accent}; outline-offset: 2px; }

.cos-home-tile {
  transition: transform 180ms cubic-bezier(0.2,0.8,0.2,1), border-color 160ms ease, background-color 160ms ease;
}
@media (hover: hover) {
  .cos-home-tile:hover { border-color: ${tokens.accentBorder}; transform: translateY(-2px); }
  .cos-home-tile:hover .cos-home-tile-arrow { opacity: 1; transform: translateX(0); }
}
.cos-home-tile:focus-visible { outline: 2px solid ${tokens.accent}; outline-offset: 2px; }
.cos-home-tile-arrow { opacity: 0; transform: translateX(-3px); transition: opacity 160ms ease, transform 180ms cubic-bezier(0.2,0.8,0.2,1); }

.cos-home-row { transition: background-color 140ms ease, border-color 160ms ease, transform 160ms cubic-bezier(0.2,0.8,0.2,1); }
@media (hover: hover) {
  .cos-home-row:hover { background: ${tokens.cardElevated}; border-color: ${tokens.accentBorder}; }
  .cos-home-row:hover .cos-home-row-go { opacity: 1; transform: translateX(0); }
}
.cos-home-row:focus-visible { outline: 2px solid ${tokens.accent}; outline-offset: 1px; }
.cos-home-row-go { opacity: 0; transform: translateX(-3px); transition: opacity 160ms ease, transform 180ms cubic-bezier(0.2,0.8,0.2,1); }

.cos-home-drawer { animation: cos-home-drawer-in 320ms cubic-bezier(0.2, 0.8, 0.2, 1) both; }
.cos-home-scrim { animation: cos-home-fade-in 200ms ease both; }
.cos-home-pulse-dot { animation: cos-home-pulse 2200ms ease-in-out infinite; }

@media (prefers-reduced-motion: reduce) {
  .cos-home-enter, .cos-home-drawer, .cos-home-scrim, .cos-home-pulse-dot { animation: none; }
  .cos-home-card, .cos-home-tile, .cos-home-row { transition: none; }
  .cos-home-card:hover, .cos-home-tile:hover, .cos-home-row:hover { transform: none; }
  .cos-home-tile-arrow, .cos-home-row-go { opacity: 1; transform: none; }
}
`;

export function HomeSurfaceStyles() {
  return <style id={HOME_STYLE_ID} dangerouslySetInnerHTML={{ __html: CSS }} />;
}
