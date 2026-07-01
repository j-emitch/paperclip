/**
 * `DiagnosticsRail` — the cockpit's health rail (spec §7.5). Renders the agent
 * diagnostics worst-first (warn before info) with a severity dot AND a text label
 * (non-color cue), or a positive "All systems nominal." all-clear when there are
 * none. Info-severity model-drift caveats are visually calmer than warnings, so a
 * roster of four claude-model agents never drowns a real mismatch.
 */

import type { AgentDiagnosticV1 } from "../../contracts/index.js";
import { tokens, statusColors } from "../tokens.js";
import { Dot } from "../shared/badges.js";
import { CalmNote } from "../shared/feedback.js";

const SEVERITY_TONE: Record<AgentDiagnosticV1["severity"], string> = {
  warn: statusColors.revise,
  info: statusColors.reviewUnknown,
};

const CODE_LABELS: Record<AgentDiagnosticV1["code"], string> = {
  handoff_mismatch: "Hand-off mismatch",
  unknown_owner_agent: "Unknown owner",
  missing_sidecar: "Missing sidecar",
  model_drift: "Model drift",
};

export interface DiagnosticsRailProps {
  diagnostics: readonly AgentDiagnosticV1[];
  warnCount: number;
  infoCount: number;
}

export function DiagnosticsRail({ diagnostics, warnCount, infoCount }: DiagnosticsRailProps) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, letterSpacing: 0.3, color: tokens.fg, textTransform: "uppercase" }}>
          Diagnostics
        </h3>
        <span style={{ fontSize: 11.5, color: tokens.muted }}>
          {warnCount} warning{warnCount === 1 ? "" : "s"} · {infoCount} info
        </span>
      </div>

      {diagnostics.length === 0 ? (
        <CalmNote tone={statusColors.ship}>All systems nominal.</CalmNote>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {diagnostics.map((diagnostic, i) => {
            const tone = SEVERITY_TONE[diagnostic.severity];
            return (
              <div
                key={diagnostic.code + ":" + (diagnostic.agentKey ?? "_") + ":" + i}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 9,
                  padding: "9px 2px",
                  borderTop: i > 0 ? `1px solid ${tokens.border}` : undefined,
                  minWidth: 0,
                }}
              >
                <span style={{ display: "inline-flex", marginTop: 4 }}>
                  <Dot tone={tone} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12, fontWeight: 650, color: tokens.fg }}>{CODE_LABELS[diagnostic.code]}</span>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: 0.4,
                        textTransform: "uppercase",
                        color: tone,
                        fontFamily: tokens.mono,
                      }}
                    >
                      {diagnostic.severity}
                    </span>
                    {diagnostic.agentKey ? (
                      <span style={{ fontSize: 10.5, color: tokens.muted, fontFamily: tokens.mono }}>{diagnostic.agentKey}</span>
                    ) : null}
                  </div>
                  <p style={{ margin: "2px 0 0", fontSize: 11.5, color: tokens.muted, lineHeight: 1.45 }}>{diagnostic.message}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
