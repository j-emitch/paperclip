/**
 * One scoped stylesheet for the Reports + Routines surfaces — the things inline
 * styles can't express: `:hover` lift, `:focus-visible` rings, and the markdown
 * body typography (host `<MarkdownBlock>` renders semantic tags we style here).
 * All motion is suppressed under `prefers-reduced-motion`. Rendered once at the
 * root of each pure view, so it's present identically under SSR (the Playwright
 * harness) and live. Trusted local constant — the only interpolation is design
 * tokens.
 */

import { tokens, statusColors } from "../tokens.js";

export const COCKPIT_SURFACE_STYLE_ID = "cos-surface-styles";

const CSS = `
.cos-chip-hover { transition: background-color 140ms ease, border-color 140ms ease, color 140ms ease, transform 160ms cubic-bezier(0.2,0.8,0.2,1); }
@media (hover: hover) {
  .cos-chip-hover:hover { border-color: ${tokens.accentBorder}; transform: translateY(-1px); }
}
.cos-chip-hover:focus-visible { outline: 2px solid ${tokens.accent}; outline-offset: 2px; }
select:focus-visible, input:focus-visible { outline: 2px solid ${tokens.accent}; outline-offset: 1px; }
.cos-report-body :where(h1,h2,h3,h4) { color: ${tokens.fg}; font-weight: 700; letter-spacing: -0.2px; line-height: 1.3; margin: 1.1em 0 0.45em; }
.cos-report-body :where(h1) { font-size: 1.5em; }
.cos-report-body :where(h2) { font-size: 1.25em; }
.cos-report-body :where(h3) { font-size: 1.08em; }
.cos-report-body :where(p, ul, ol, blockquote, table) { margin: 0 0 0.7em; }
.cos-report-body :where(a) { color: ${statusColors.proceed}; text-decoration: none; }
.cos-report-body :where(a):hover { text-decoration: underline; }
.cos-report-body :where(code) { font-family: ${tokens.mono}; font-size: 0.88em; background: ${tokens.secondary}; padding: 1px 5px; border-radius: 5px; }
.cos-report-body :where(pre) { background: ${tokens.bg}; border: 1px solid ${tokens.border}; border-radius: ${tokens.radiusSm}px; padding: 12px 14px; overflow-x: auto; }
.cos-report-body :where(pre) code { background: transparent; padding: 0; }
.cos-report-body :where(blockquote) { border-left: 3px solid ${tokens.border}; padding-left: 12px; color: ${tokens.muted}; }
.cos-report-body :where(table) { border-collapse: collapse; width: 100%; font-size: 0.95em; }
.cos-report-body :where(th, td) { border: 1px solid ${tokens.border}; padding: 5px 9px; text-align: left; }
.cos-report-body :where(hr) { border: none; border-top: 1px solid ${tokens.border}; margin: 1em 0; }
.cos-report-body :where(img) { max-width: 100%; height: auto; }
@media (prefers-reduced-motion: reduce) {
  .cos-chip-hover { transition: none; }
  .cos-chip-hover:hover { transform: none; }
}
`;

export function CockpitSurfaceStyles() {
  return <style id={COCKPIT_SURFACE_STYLE_ID} dangerouslySetInnerHTML={{ __html: CSS }} />;
}
