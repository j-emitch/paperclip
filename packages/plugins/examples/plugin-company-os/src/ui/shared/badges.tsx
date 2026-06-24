/**
 * Generic visual atoms shared across the cockpit — `Pill`, `Dot`, `RepoBadge`.
 * They carry NO domain vocabulary (no verdict/freshness enums); each surface's
 * view-model owns its label + tone maps and feeds them in. That keeps the board's
 * cross-repo badge, the reports type chips, and the routines verdict pills
 * visually identical without coupling this module to any one tab's enums.
 */

import type { CSSProperties, ReactNode } from "react";
import { tokens } from "../tokens.js";

/** A small status dot in an arbitrary tone. */
export function Dot({ tone, size = 8 }: { tone: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{ display: "inline-block", width: size, height: size, borderRadius: 999, background: tone, flex: "0 0 auto" }}
    />
  );
}

export interface PillProps {
  label: ReactNode;
  /** Accent tone (text + border + tint). Defaults to muted. */
  tone?: string;
  /** Solid-ish tinted background when true; otherwise transparent. */
  soft?: boolean;
  /** Optional leading dot in the tone. */
  withDot?: boolean;
  /** Optional leading icon node. */
  icon?: ReactNode;
  title?: string;
  /** Accessible label when the visible content is glyph-only. */
  ariaLabel?: string;
  style?: CSSProperties;
}

/** A compact rounded pill. Tone drives text + border; `soft` adds a tinted fill. */
export function Pill({ label, tone = tokens.muted, soft = false, withDot = false, icon, title, ariaLabel, style }: PillProps) {
  return (
    <span
      title={title}
      aria-label={ariaLabel}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: 0.2,
        lineHeight: 1.4,
        whiteSpace: "nowrap",
        color: tone,
        background: soft ? withAlpha(tone, 0.16) : "transparent",
        border: `1px solid ${soft ? "transparent" : tokens.border}`,
        ...style,
      }}
    >
      {withDot ? <Dot tone={tone} /> : null}
      {icon ? (
        <span aria-hidden="true" style={{ display: "inline-flex" }}>
          {icon}
        </span>
      ) : null}
      {label}
    </span>
  );
}

/** A monospace repo chip — the cross-repo provenance marker. */
export function RepoBadge({ repo, title }: { repo: string; title?: string }) {
  return (
    <span
      title={title ?? `Repo: ${repo}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "1px 6px",
        borderRadius: 5,
        fontSize: 10.5,
        fontWeight: 600,
        fontFamily: tokens.mono,
        letterSpacing: 0.1,
        color: tokens.muted,
        background: tokens.secondary,
        border: `1px solid ${tokens.border}`,
        whiteSpace: "nowrap",
      }}
    >
      {repo}
    </span>
  );
}

/**
 * A translucent tint of a tone for soft pill fills. Rather than `color-mix` (which
 * has no graceful inline-style fallback if unsupported — it just yields an invalid
 * background), we inject an alpha into the functional color itself
 * (`oklch(L C H / a)` / `hsl(H S L / a)`), which every target renderer supports.
 * A color we can't parse falls back to the solid tone.
 */
function withAlpha(tone: string, alpha: number): string {
  const m = /^(oklch|oklab|hsl|hwb|lab|lch|rgb)\(([^)]*)\)$/.exec(tone.trim());
  if (!m) return tone;
  const inner = m[2].includes("/") ? m[2].slice(0, m[2].indexOf("/")).trim() : m[2].trim();
  return `${m[1]}(${inner} / ${alpha})`;
}
