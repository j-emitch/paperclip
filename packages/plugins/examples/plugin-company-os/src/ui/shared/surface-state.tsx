/**
 * The cockpit's shared tab-level state frames — the cold-cache spinner, the
 * worker-unreachable error, and the not-yet-derived empty panel. Home, Source,
 * and Docs all render the identical three-state contract around their connected
 * data fetch, so the frame structure (centred `Frame` + `Glyph` + retry/refresh)
 * lives here and each surface only supplies its icon + copy (codex B). Pure +
 * prop-driven — no host bridge.
 */

import type { ReactNode } from "react";
import { statusColors, tokens } from "../tokens.js";
import { Frame, Glyph, LocalSpinner, ghostButtonStyle } from "./feedback.js";
import { AlertIcon, RefreshIcon } from "../icons.js";

export function SurfaceLoading({ label }: { label: string }) {
  return (
    <Frame>
      <LocalSpinner />
      <p style={{ margin: 0, fontSize: 14, color: tokens.muted }} aria-live="polite">
        {label}
      </p>
    </Frame>
  );
}

export function SurfaceError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Frame>
      <Glyph tone={statusColors.danger}>
        <AlertIcon size={24} />
      </Glyph>
      <div>
        <p style={{ margin: 0, fontSize: 15, fontWeight: 650, color: tokens.fg }}>Couldn’t reach the worker</p>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: tokens.muted, maxWidth: 380 }}>{message}</p>
      </div>
      <RefreshButton onClick={onRetry} label="Try again" />
    </Frame>
  );
}

export function SurfaceEmpty({
  icon,
  title,
  body,
  onRefresh,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  onRefresh?: () => void;
}) {
  return (
    <Frame>
      <Glyph tone={tokens.accent}>{icon}</Glyph>
      <div>
        <p style={{ margin: 0, fontSize: 15, fontWeight: 650, color: tokens.fg }}>{title}</p>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: tokens.muted, maxWidth: 420, lineHeight: 1.5 }}>{body}</p>
      </div>
      {onRefresh ? <RefreshButton onClick={onRefresh} label="Refresh" /> : null}
    </Frame>
  );
}

function RefreshButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} style={ghostButtonStyle}>
      <span aria-hidden="true" style={{ display: "inline-flex" }}>
        <RefreshIcon size={14} />
      </span>
      {label}
    </button>
  );
}
