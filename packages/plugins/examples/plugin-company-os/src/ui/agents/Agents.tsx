/**
 * `Agents` — the data-connected Agents cockpit tab. Owns the `agent-system` fetch
 * + the selected-agent state and delegates all rendering to the pure `AgentsView`.
 * Cold cache / worker error / no-agents each render an explicit, non-crashing
 * panel (the same framing the other cockpit surfaces use).
 */

import { useState } from "react";
import { tokens } from "../tokens.js";
import { Frame, Glyph, LocalSpinner, ghostButtonStyle } from "../shared/feedback.js";
import { AlertIcon, RefreshIcon, RoutinesIcon } from "../icons.js";
import { useAgentSystem } from "../hooks/useAgentSystem.js";
import { useIsMobile } from "../hooks/useMediaQuery.js";
import { useNow } from "../hooks/useNow.js";
import { AgentsView } from "./AgentsView.js";

export function Agents({ companyId }: { companyId: string | null }) {
  const isMobile = useIsMobile();
  const now = useNow();
  const { agentSystem, loading, error, refresh } = useAgentSystem(companyId);
  const [selectedAgentKey, setSelectedAgentKey] = useState<string | null>(null);

  if (loading && !agentSystem) {
    return (
      <Frame>
        <LocalSpinner />
        <p style={{ margin: 0, fontSize: 14, color: tokens.muted }} aria-live="polite">
          Loading the agent workforce…
        </p>
      </Frame>
    );
  }

  if (error && !agentSystem) {
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

  if (!agentSystem) {
    return (
      <Frame>
        <Glyph tone={tokens.accent}>
          <RoutinesIcon size={24} />
        </Glyph>
        <div>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 650, color: tokens.fg }}>No agent system yet</p>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: tokens.muted, maxWidth: 420, lineHeight: 1.5 }}>
            Agents are read from each directive’s <code style={{ fontFamily: tokens.mono }}>company-os.json</code> sidecar on the next derive.
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

  return (
    <AgentsView
      system={agentSystem}
      now={now}
      isMobile={isMobile}
      selectedAgentKey={selectedAgentKey}
      onSelectAgent={setSelectedAgentKey}
    />
  );
}
