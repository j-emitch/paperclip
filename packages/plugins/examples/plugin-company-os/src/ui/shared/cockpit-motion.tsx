/**
 * One scoped stylesheet for the cockpit's interactive surfaces (`cos-fx-*`) — the
 * things inline styles can't express: the staggered panel/card entrance, the
 * hover lift + tactile press on clickable tiles/cards/rows, the caret rotation,
 * the drawer slide-in, and the alert-rail pulse. Shared by Home, Source, and Docs
 * so the interaction language is identical across the cockpit. ALL motion is
 * suppressed under `prefers-reduced-motion`, so that viewport is genuinely still.
 * Rendered once at the root of each surface, so it's identical under SSR (the
 * Playwright harness) and live. Trusted local constant — the only interpolation
 * is design tokens.
 */

import { tokens, statusColors } from "../tokens.js";
import { withAlpha } from "./color.js";

export const COCKPIT_MOTION_STYLE_ID = "cos-fx-styles";

const CSS = `
@keyframes cos-fx-rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
@keyframes cos-fx-drawer-in { from { opacity: 0; transform: translateX(24px); } to { opacity: 1; transform: none; } }
@keyframes cos-fx-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes cos-fx-pulse { 0%, 100% { box-shadow: 0 0 0 0 ${withAlpha(statusColors.danger, 0.5)}; } 50% { box-shadow: 0 0 0 4px ${withAlpha(statusColors.danger, 0)}; } }

.cos-fx-enter { animation: cos-fx-rise 460ms cubic-bezier(0.2, 0.8, 0.2, 1) both; }

.cos-fx-card {
  transition: transform 180ms cubic-bezier(0.2,0.8,0.2,1), border-color 160ms ease, background-color 160ms ease, box-shadow 200ms ease;
}
@media (hover: hover) {
  .cos-fx-card:hover { border-color: ${tokens.accentBorder}; transform: translateY(-2px); box-shadow: 0 8px 24px -16px rgba(0,0,0,0.55); }
}
.cos-fx-card:not(:disabled):active { transform: translateY(0) scale(0.992); }
.cos-fx-card:focus-visible { outline: 2px solid ${tokens.accent}; outline-offset: 2px; }

.cos-fx-tile {
  transition: transform 180ms cubic-bezier(0.2,0.8,0.2,1), border-color 160ms ease, background-color 160ms ease;
}
@media (hover: hover) {
  .cos-fx-tile:hover { border-color: ${tokens.accentBorder}; transform: translateY(-2px); }
  .cos-fx-tile:hover .cos-fx-tile-arrow { opacity: 1; transform: translateX(0); }
}
.cos-fx-tile:active { transform: translateY(0) scale(0.992); }
.cos-fx-tile:focus-visible { outline: 2px solid ${tokens.accent}; outline-offset: 2px; }
.cos-fx-tile-arrow { opacity: 0; transform: translateX(-3px); transition: opacity 160ms ease, transform 180ms cubic-bezier(0.2,0.8,0.2,1); }

.cos-fx-row { transition: background-color 140ms ease, border-color 160ms ease, transform 160ms cubic-bezier(0.2,0.8,0.2,1); }
@media (hover: hover) {
  .cos-fx-row:hover { background: ${tokens.cardElevated}; border-color: ${tokens.accentBorder}; }
  .cos-fx-row:hover .cos-fx-row-go { opacity: 1; transform: translateX(0); }
}
.cos-fx-row:active { transform: scale(0.994); }
.cos-fx-row:focus-visible { outline: 2px solid ${tokens.accent}; outline-offset: 1px; }
.cos-fx-row-go { opacity: 0; transform: translateX(-3px); transition: opacity 160ms ease, transform 180ms cubic-bezier(0.2,0.8,0.2,1); }

.cos-fx-seeall { transition: color 140ms ease, background-color 140ms ease; }
@media (hover: hover) {
  .cos-fx-seeall:hover { color: ${tokens.accent}; background: ${withAlpha(tokens.accent, 0.12)}; }
  .cos-fx-seeall:hover span { transform: translateX(2px); }
}
.cos-fx-seeall span { display: inline-block; transition: transform 180ms cubic-bezier(0.2,0.8,0.2,1); }
.cos-fx-seeall:focus-visible { outline: 2px solid ${tokens.accent}; outline-offset: 2px; }

.cos-fx-caret { transition: transform 180ms cubic-bezier(0.2,0.8,0.2,1); }

.cos-fx-drawer { animation: cos-fx-drawer-in 320ms cubic-bezier(0.2, 0.8, 0.2, 1) both; }
.cos-fx-scrim { animation: cos-fx-fade-in 200ms ease both; }
.cos-fx-fade { animation: cos-fx-fade-in 220ms ease both; }
.cos-fx-pulse-dot { animation: cos-fx-pulse 2200ms ease-in-out infinite; }

@media (prefers-reduced-motion: reduce) {
  .cos-fx-enter, .cos-fx-drawer, .cos-fx-scrim, .cos-fx-fade, .cos-fx-pulse-dot { animation: none; }
  .cos-fx-card, .cos-fx-tile, .cos-fx-row, .cos-fx-seeall, .cos-fx-seeall span, .cos-fx-caret,
  .cos-fx-tile-arrow, .cos-fx-row-go { transition: none; }
  .cos-fx-card:hover, .cos-fx-tile:hover, .cos-fx-row:hover,
  .cos-fx-card:active, .cos-fx-tile:active, .cos-fx-row:active,
  .cos-fx-seeall:hover span { transform: none; }
  .cos-fx-tile-arrow, .cos-fx-row-go { opacity: 1; transform: none; }
}
`;

export function CockpitMotionStyles() {
  return <style id={COCKPIT_MOTION_STYLE_ID} dangerouslySetInnerHTML={{ __html: CSS }} />;
}
