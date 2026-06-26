/**
 * One shared color helper for the whole cockpit UI. Several surfaces need a
 * translucent tint of a functional color (a soft pill fill, a flagged-tile
 * background, a keyframe's tinted box-shadow). Rather than `color-mix` (no
 * graceful inline-style fallback) we inject an alpha into the functional color
 * itself (`oklch(L C H / a)` / `hsl(H S L / a)`), which every target renderer
 * supports. Defined ONCE here so the board badges, the Home tiles, and the Home
 * keyframes can't drift on how they fade a tone. A color we can't parse falls
 * back to the solid tone.
 */

const FUNCTIONAL_COLOR = /^(oklch|oklab|hsl|hwb|lab|lch|rgb)\(([^)]*)\)$/;
// `var(--name, <functional-fallback>)` — apply the alpha to the fallback so a
// token like `tokens.muted` (a CSS var with an oklch fallback) doesn't silently
// degrade to a SOLID fill behind a `soft` pill (codex B). If there is no parseable
// fallback we return the var unchanged (the caller still gets a valid color).
const VAR_WITH_FALLBACK = /^var\(\s*(--[^,]+),\s*(.+)\)$/s;

export function withAlpha(tone: string, alpha: number): string {
  const trimmed = tone.trim();
  const m = FUNCTIONAL_COLOR.exec(trimmed);
  if (m) {
    const inner = m[2].includes("/") ? m[2].slice(0, m[2].indexOf("/")).trim() : m[2].trim();
    return `${m[1]}(${inner} / ${alpha})`;
  }
  const v = VAR_WITH_FALLBACK.exec(trimmed);
  if (v) {
    const faded = withAlpha(v[2].trim(), alpha);
    return `var(${v[1].trim()}, ${faded})`;
  }
  return tone;
}
