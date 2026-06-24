/**
 * The board's non-data states — loading (first fetch / refresh), error (worker
 * unreachable), and empty (cold cache before the first derive, or a workspace
 * with nothing to classify yet). All three are pure + prop-driven so they render
 * identically under SSR (the Playwright harness) and live.
 */

import { statusColors, tokens } from "../tokens.js";
import { InboxIcon, PlugOffIcon, RefreshIcon } from "../icons.js";
import { Frame, Glyph, LocalSpinner, ghostButtonStyle } from "../shared/feedback.js";

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
        <button type="button" className="cos-refresh" onClick={onRetry} style={ghostButtonStyle}>
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
          style={{ ...ghostButtonStyle, opacity: refreshing ? 0.7 : 1, cursor: refreshing ? "default" : "pointer" }}
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
