/**
 * `Source` — the data-connected Source tab. Owns the `git-state` fetch + the
 * cold/error/empty states; everything visual is delegated to the pure
 * `SourceView`. No selection or drawer state (the Source tree is a read-only
 * audit), so this is a thin connector around `useGitState`.
 */

import { tokens } from "../tokens.js";
import { Frame, Glyph, LocalSpinner, ghostButtonStyle } from "../shared/feedback.js";
import { AlertIcon, RefreshIcon, SourceIcon } from "../icons.js";
import { useGitState } from "../hooks/useGitState.js";
import { useIsMobile } from "../hooks/useMediaQuery.js";
import { useNow } from "../hooks/useNow.js";
import { SourceView } from "./SourceView.js";

export function Source({ companyId }: { companyId: string | null }) {
  const isMobile = useIsMobile();
  const now = useNow();
  const { gitState, loading, error, refresh } = useGitState(companyId);

  if (loading && !gitState) return <SourceLoading />;
  if (error && !gitState) return <SourceError message={error.message} onRetry={refresh} />;
  if (!gitState) return <SourceEmpty onRefresh={companyId ? refresh : undefined} />;

  return <SourceView gitState={gitState} now={now} isMobile={isMobile} />;
}

function SourceLoading() {
  return (
    <Frame>
      <LocalSpinner />
      <p style={{ margin: 0, fontSize: 14, color: tokens.muted }} aria-live="polite">
        Reading the working trees…
      </p>
    </Frame>
  );
}

function SourceError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Frame>
      <Glyph tone="oklch(0.64 0.21 25)">
        <AlertIcon size={24} />
      </Glyph>
      <div>
        <p style={{ margin: 0, fontSize: 15, fontWeight: 650, color: tokens.fg }}>Couldn’t reach the worker</p>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: tokens.muted, maxWidth: 380 }}>{message}</p>
      </div>
      <button type="button" onClick={onRetry} style={ghostButtonStyle}>
        <span aria-hidden="true" style={{ display: "inline-flex" }}>
          <RefreshIcon size={14} />
        </span>
        Try again
      </button>
    </Frame>
  );
}

function SourceEmpty({ onRefresh }: { onRefresh?: () => void }) {
  return (
    <Frame>
      <Glyph tone={tokens.accent}>
        <SourceIcon size={24} />
      </Glyph>
      <div>
        <p style={{ margin: 0, fontSize: 15, fontWeight: 650, color: tokens.fg }}>No source state yet</p>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: tokens.muted, maxWidth: 420, lineHeight: 1.5 }}>
          The cockpit reads each repo’s branches, worktrees, and recent commits. They appear here on the next derive.
        </p>
      </div>
      {onRefresh ? (
        <button type="button" onClick={onRefresh} style={ghostButtonStyle}>
          <span aria-hidden="true" style={{ display: "inline-flex" }}>
            <RefreshIcon size={14} />
          </span>
          Refresh
        </button>
      ) : null}
    </Frame>
  );
}
