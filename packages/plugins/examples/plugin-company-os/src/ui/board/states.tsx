/**
 * The board's non-data states — loading (first fetch / refresh), error (worker
 * unreachable), and empty (cold cache before the first derive, or a workspace
 * with nothing to classify yet). All three are pure + prop-driven so they render
 * identically under SSR (the Playwright harness) and live.
 */

import type { ReactNode } from "react";
import { statusColors, tokens } from "../tokens.js";
import { InboxIcon, PlugOffIcon, RefreshIcon } from "../icons.js";

/**
 * Self-contained spinner — its own scoped keyframe + reduced-motion guard so the
 * loading state renders identically under SSR (the Playwright harness) and live,
 * with no dependency on the host bridge runtime.
 */
function LocalSpinner() {
  return (
    <span role="status" aria-label="Loading" className="cos-state-spinner">
      <style
        dangerouslySetInnerHTML={{
          __html: `@keyframes cos-state-spin{to{transform:rotate(360deg)}}
.cos-state-spinner{display:inline-block;width:24px;height:24px;border-radius:999px;border:2.5px solid ${tokens.border};border-top-color:${tokens.accent};animation:cos-state-spin 720ms linear infinite}
@media (prefers-reduced-motion:reduce){.cos-state-spinner{animation:none}}`,
        }}
      />
    </span>
  );
}

function Frame({ children }: { children: ReactNode }) {
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
        minHeight: 220,
        background: tokens.card,
        border: `1px solid ${tokens.border}`,
        borderRadius: tokens.radius,
      }}
    >
      {children}
    </div>
  );
}

function Glyph({ children, tone = tokens.muted }: { children: ReactNode; tone?: string }) {
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

export function LoadingState() {
  return (
    <Frame>
      <LocalSpinner />
      <p style={{ margin: 0, fontSize: 14, color: tokens.muted }} aria-live="polite">
        Loading the board…
      </p>
    </Frame>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Frame>
      <Glyph tone={statusColors.danger}>
        <PlugOffIcon size={26} />
      </Glyph>
      <div>
        <p style={{ margin: 0, fontSize: 15, fontWeight: 650, color: tokens.fg }}>Couldn’t reach the worker</p>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: tokens.muted, maxWidth: 380 }}>{message}</p>
      </div>
      {onRetry ? (
        <button type="button" className="cos-refresh" onClick={onRetry} style={retryButtonStyle}>
          <span aria-hidden="true" className="cos-caret" style={{ display: "inline-flex" }}>
            <RefreshIcon size={14} />
          </span>
          Try again
        </button>
      ) : null}
    </Frame>
  );
}

export function EmptyState({ onRefresh, refreshing = false }: { onRefresh?: () => void; refreshing?: boolean }) {
  return (
    <Frame>
      <Glyph tone={tokens.accent}>
        <InboxIcon size={26} />
      </Glyph>
      <div>
        <p style={{ margin: 0, fontSize: 15, fontWeight: 650, color: tokens.fg }}>No work on the board yet</p>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: tokens.muted, maxWidth: 420, lineHeight: 1.5 }}>
          The cockpit hasn’t derived any chips yet. The board fills in automatically as branches,
          PRs, specs, and merges land across the workspace.
        </p>
      </div>
      {onRefresh ? (
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label={refreshing ? "Deriving the board" : "Derive the board now"}
          style={{ ...retryButtonStyle, opacity: refreshing ? 0.7 : 1, cursor: refreshing ? "default" : "pointer" }}
        >
          {refreshing ? (
            <LocalSpinner />
          ) : (
            <span aria-hidden="true" style={{ display: "inline-flex" }}>
              <RefreshIcon size={14} />
            </span>
          )}
          {refreshing ? "Deriving…" : "Derive now"}
        </button>
      ) : null}
    </Frame>
  );
}

const retryButtonStyle = {
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
} as const;
