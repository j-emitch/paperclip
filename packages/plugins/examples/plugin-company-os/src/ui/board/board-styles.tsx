/**
 * Board motion + interaction stylesheet.
 *
 * The cockpit styles its layout with inline styles (so it stays self-contained
 * and themeable per-call-site), but a few things inline styles genuinely cannot
 * express: `@keyframes`, `:hover`/`:focus-visible` pseudo-states, and a
 * `prefers-reduced-motion` override. Those live here, scoped under the `.cos-board`
 * root class so nothing leaks into the host. Rendered once by `CompanyOsBoardView`.
 *
 * Reduced motion is handled natively via the media query (not a JS hook) so it
 * works under SSR + Playwright `prefers-reduced-motion` emulation with no client
 * JS — the most robust path for a plugin that can't ship a real CSS file.
 */

import { springCurve, tokens } from "../tokens.js";

export const BOARD_STYLE_ID = "cos-board-styles";
export const BOARD_ROOT_CLASS = "cos-board";

const CSS = `
.${BOARD_ROOT_CLASS} { --cos-spring: ${springCurve}; }

/* Chip entrance — a gentle spring rise. Staggered via inline animation-delay. */
@keyframes cos-chip-in {
  from { opacity: 0; transform: translateY(6px) scale(0.985); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes cos-lane-in {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes cos-pulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.45; }
}

.${BOARD_ROOT_CLASS} .cos-chip {
  animation: cos-chip-in 360ms var(--cos-spring) both;
  transition: transform 200ms var(--cos-spring), box-shadow 200ms ease, border-color 160ms ease, background-color 160ms ease;
}
.${BOARD_ROOT_CLASS} .cos-chip:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 18px -8px rgba(0,0,0,0.55);
  border-color: ${tokens.accentBorder};
}
.${BOARD_ROOT_CLASS} .cos-chip:active { transform: translateY(0) scale(0.99); }

.${BOARD_ROOT_CLASS} .cos-lane { animation: cos-lane-in 280ms var(--cos-spring) both; }

.${BOARD_ROOT_CLASS} .cos-collapse {
  transition: background-color 160ms ease, color 160ms ease, transform 200ms var(--cos-spring);
}
.${BOARD_ROOT_CLASS} .cos-collapse:hover { background: ${tokens.secondary}; color: ${tokens.fg}; }
.${BOARD_ROOT_CLASS} .cos-caret { transition: transform 240ms var(--cos-spring); display: inline-flex; }
.${BOARD_ROOT_CLASS} .cos-caret[data-collapsed="true"] { transform: rotate(-90deg); }

.${BOARD_ROOT_CLASS} .cos-pulse { animation: cos-pulse 1.8s ease-in-out infinite; }

.${BOARD_ROOT_CLASS} .cos-refresh {
  transition: background-color 160ms ease, color 160ms ease, transform 180ms var(--cos-spring), border-color 160ms ease;
}
.${BOARD_ROOT_CLASS} .cos-refresh:hover:not(:disabled) { transform: translateY(-1px); border-color: ${tokens.accentBorder}; color: ${tokens.fg}; }
.${BOARD_ROOT_CLASS} .cos-refresh:active:not(:disabled) { transform: translateY(0) scale(0.98); }
.${BOARD_ROOT_CLASS} .cos-refresh[data-spinning="true"] .cos-caret { animation: cos-spin 900ms linear infinite; }
@keyframes cos-spin { to { transform: rotate(360deg); } }

/* Keyboard focus is always visible + uses the cockpit accent. */
.${BOARD_ROOT_CLASS} :focus-visible {
  outline: 2px solid ${tokens.accent};
  outline-offset: 2px;
  border-radius: ${tokens.radiusSm}px;
}

@media (prefers-reduced-motion: reduce) {
  .${BOARD_ROOT_CLASS} .cos-chip,
  .${BOARD_ROOT_CLASS} .cos-lane,
  .${BOARD_ROOT_CLASS} .cos-collapse,
  .${BOARD_ROOT_CLASS} .cos-caret,
  .${BOARD_ROOT_CLASS} .cos-pulse,
  .${BOARD_ROOT_CLASS} .cos-refresh,
  .${BOARD_ROOT_CLASS} .cos-refresh[data-spinning="true"] .cos-caret {
    animation: none !important;
    transition: none !important;
  }
  .${BOARD_ROOT_CLASS} .cos-chip:hover,
  .${BOARD_ROOT_CLASS} .cos-refresh:hover:not(:disabled) { transform: none; }
}
`;

/** Single `<style>` tag, rendered once at the board root. Idempotent by id. */
export function BoardStyles() {
  return <style id={BOARD_STYLE_ID} dangerouslySetInnerHTML={{ __html: CSS }} />;
}
