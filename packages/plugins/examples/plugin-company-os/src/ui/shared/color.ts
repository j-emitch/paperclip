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

export function withAlpha(tone: string, alpha: number): string {
  const m = FUNCTIONAL_COLOR.exec(tone.trim());
  if (!m) return tone;
  const inner = m[2].includes("/") ? m[2].slice(0, m[2].indexOf("/")).trim() : m[2].trim();
  return `${m[1]}(${inner} / ${alpha})`;
}
