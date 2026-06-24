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
        background: soft ? tintOf(tone) : "transparent",
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
 * A translucent tint of an oklch/hsl tone for soft pill fills. We can't derive an
 * alpha from an arbitrary color string at runtime, so we wrap it in
 * `color-mix` (supported in the host's modern Chromium) with a transparent
 * partner — degrading to the solid tone is acceptable on the rare non-support.
 */
function tintOf(tone: string): string {
  return `color-mix(in oklch, ${tone} 16%, transparent)`;
}
