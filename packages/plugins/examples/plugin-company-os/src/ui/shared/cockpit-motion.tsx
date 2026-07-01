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
@keyframes cos-fx-agent-pulse { 0%, 100% { opacity: 0.12; } 50% { opacity: 0.42; } }
@keyframes cos-fx-drawer-open { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
@keyframes cos-fx-flow { from { background-position: 0 0; } to { background-position: 16px 0; } }
@keyframes cos-fx-live { 0%, 100% { box-shadow: 0 0 0 0 ${withAlpha(statusColors.live, 0.5)}; } 50% { box-shadow: 0 0 0 4px ${withAlpha(statusColors.live, 0)}; } }

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
.cos-fx-agent-pulse { animation: cos-fx-agent-pulse 2800ms ease-in-out infinite; }
/* A "live" indicator — a gentle green ring pulse (the Atlas freshness dot). */
.cos-fx-live-dot { border-radius: 999px; animation: cos-fx-live 2200ms ease-in-out infinite; }
/* A slow leftward flow for a rolling-program's striped built bar. */
.cos-fx-flow { animation: cos-fx-flow 1.4s linear infinite; }

summary.cos-fx-summary { list-style: none; }
summary.cos-fx-summary::-webkit-details-marker { display: none; }
summary.cos-fx-summary .cos-fx-caret { transform: rotate(-90deg); }
details[open] > summary.cos-fx-summary .cos-fx-caret { transform: rotate(0deg); }
details[open] > .cos-fx-drawer-body { animation: cos-fx-drawer-open 260ms cubic-bezier(0.2, 0.8, 0.2, 1) both; }

@media (prefers-reduced-motion: reduce) {
  .cos-fx-enter, .cos-fx-drawer, .cos-fx-scrim, .cos-fx-fade, .cos-fx-pulse-dot, .cos-fx-agent-pulse,
  .cos-fx-flow, .cos-fx-live-dot { animation: none; }
  /* The drawer-open rule is \`details[open] > .cos-fx-drawer-body\` (specificity 0,2,1);
     a bare \`.cos-fx-drawer-body\` (0,1,0) reset loses on specificity and the fade would
     still play under reduced-motion — match the selector so the override actually wins. */
  details[open] > .cos-fx-drawer-body { animation: none; }
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
