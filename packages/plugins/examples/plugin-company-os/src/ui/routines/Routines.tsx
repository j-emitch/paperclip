/**
 * `Routines` — the data-connected Routines tab. Owns the routine-health fetch and
 * delegates all rendering to the pure `RoutinesView`. Cold cache / worker error /
 * empty contracts each render an explicit, non-crashing panel.
 */

import { tokens } from "../tokens.js";
import { Frame, Glyph, LocalSpinner, ghostButtonStyle } from "../shared/feedback.js";
import { AlertIcon, RefreshIcon, RoutinesIcon } from "../icons.js";
import { useRoutineHealth } from "../hooks/useRoutineHealth.js";
import { useIsMobile } from "../hooks/useMediaQuery.js";
import { useNow } from "../hooks/useNow.js";
import { RoutinesView } from "./RoutinesView.js";

export function Routines({ companyId }: { companyId: string | null }) {
  const isMobile = useIsMobile();
  const now = useNow();
  const { health, loading, error, refresh } = useRoutineHealth(companyId);

  if (loading && !health) {
    return (
      <Frame>
        <LocalSpinner />
        <p style={{ margin: 0, fontSize: 14, color: tokens.muted }} aria-live="polite">
          Loading routine health…
        </p>
      </Frame>
    );
  }

  if (error && !health) {
    return (
      <Frame>
        <Glyph tone="oklch(0.64 0.21 25)">
          <AlertIcon size={24} />
        </Glyph>
        <div>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 650, color: tokens.fg }}>Couldn’t reach the worker</p>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: tokens.muted, maxWidth: 380 }}>{error.message}</p>
        </div>
        <button type="button" onClick={refresh} style={ghostButtonStyle}>
          <span aria-hidden="true" style={{ display: "inline-flex" }}>
            <RefreshIcon size={14} />
          </span>
          Try again
        </button>
      </Frame>
    );
  }

  if (!health) {
    return (
      <Frame>
        <Glyph tone={tokens.accent}>
          <RoutinesIcon size={24} />
        </Glyph>
        <div>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 650, color: tokens.fg }}>No routine health yet</p>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: tokens.muted, maxWidth: 420, lineHeight: 1.5 }}>
            Routine contracts are read from each agent’s <code style={{ fontFamily: tokens.mono }}>company-os.json</code> sidecar on the next derive.
          </p>
        </div>
        {companyId ? (
          <button type="button" onClick={refresh} style={ghostButtonStyle}>
            <span aria-hidden="true" style={{ display: "inline-flex" }}>
              <RefreshIcon size={14} />
            </span>
            Refresh
          </button>
        ) : null}
      </Frame>
    );
  }

  return <RoutinesView health={health} now={now} isMobile={isMobile} />;
}
