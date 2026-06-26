/**
 * Shared, bridge-free feedback primitives — the centred `Frame`, the rounded
 * `Glyph`, the self-contained `LocalSpinner`, and a `GhostButton`. Extracted from
 * the board's states so the Board, Reports, and Routines surfaces render their
 * loading / error / empty panels identically (same spinner, same framing) and
 * the keyframe + reduced-motion guard live in exactly one place.
 *
 * Everything here is pure + prop-driven with NO dependency on the host SDK
 * runtime, so it renders the same under SSR (the Playwright harness) and live —
 * the same property the board relies on for `LocalSpinner`.
 */

import type { CSSProperties, ReactNode } from "react";
import { tokens } from "../tokens.js";

/**
 * Self-contained spinner — its own scoped keyframe + reduced-motion guard so any
 * loading state renders identically under SSR and live, with no host bridge.
 */
export function LocalSpinner({ size = 24 }: { size?: number }) {
  const border = Math.max(2, Math.round(size / 9.6));
  return (
    <span role="status" aria-label="Loading" className="cos-state-spinner" style={{ width: size, height: size, borderWidth: border }}>
      <style
        dangerouslySetInnerHTML={{
          __html: `@keyframes cos-state-spin{to{transform:rotate(360deg)}}
.cos-state-spinner{display:inline-block;border-radius:999px;border-style:solid;border-color:${tokens.border};border-top-color:${tokens.accent};animation:cos-state-spin 720ms linear infinite}
@media (prefers-reduced-motion:reduce){.cos-state-spinner{animation:none}}`,
        }}
      />
    </span>
  );
}

/** A centred panel frame for loading / error / empty states. */
export function Frame({ children, minHeight = 220 }: { children: ReactNode; minHeight?: number }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        textAlign: "center",
        padding: "48px 24px",
        minHeight,
        background: tokens.card,
        border: `1px solid ${tokens.border}`,
        borderRadius: tokens.radius,
      }}
    >
      {children}
    </div>
  );
}

/**
 * The cockpit's calm 0-state note — a dashed, muted line that renders an empty
 * slice as a positive "all clear" rather than hiding it (Joe's show-0-counts /
 * positive-reinforcement rule). One shape so every glance panel's empty state
 * reads identically. `tone` optionally tints the border/text for a success cue.
 */
export function CalmNote({ children, tone }: { children: ReactNode; tone?: string }) {
  return (
    <p
      style={{
        margin: 0,
        fontSize: 13,
        color: tone ?? tokens.muted,
        padding: "12px 14px",
        border: `1px dashed ${tone ?? tokens.border}`,
        borderRadius: tokens.radiusSm,
      }}
    >
      {children}
    </p>
  );
}

/** A rounded, tinted glyph badge for the panel frames. */
export function Glyph({ children, tone = tokens.muted }: { children: ReactNode; tone?: string }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 52,
        height: 52,
        borderRadius: 14,
        color: tone,
        background: tokens.secondary,
        border: `1px solid ${tokens.border}`,
      }}
    >
      {children}
    </span>
  );
}

/** Shared "secondary" button shape (retry / refresh / derive). */
export const ghostButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  padding: "8px 14px",
  borderRadius: tokens.radiusSm,
  background: tokens.secondary,
  border: `1px solid ${tokens.border}`,
  color: tokens.fg,
  font: "inherit",
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
};
