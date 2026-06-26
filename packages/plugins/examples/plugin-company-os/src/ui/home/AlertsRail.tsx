/**
 * `AlertsRail` — the unified "needs attention" triage rail (spec §5.3): routine-
 * stale/missing, branch-at-risk, and stalled-work alerts merged into ONE severity-
 * sorted column (high-first). Each alert carries a severity dot (the highest
 * pulses — color AND motion, motion suppressed under reduced-motion) plus a kind
 * label, title, detail, and a deep-link. The calm 0-state is a genuine "you're
 * clear" rather than a hidden panel. Pure — `Home` follows the deep-link.
 */

import type { DeepLink, OrientationAlertV1 } from "../../contracts/index.js";
import { statusColors, tokens } from "../tokens.js";
import { Pill } from "../shared/badges.js";
import { CalmNote } from "../shared/feedback.js";
import { CheckIcon } from "../icons.js";
import { ALERT_KIND_LABELS, ALERT_SEVERITY_RANK, ALERT_SEVERITY_TONES } from "./home-view-model.js";

export interface AlertsRailProps {
  alerts: readonly OrientationAlertV1[];
  onFollow?: (link: DeepLink) => void;
}

export function AlertsRail({ alerts, onFollow }: AlertsRailProps) {
  if (alerts.length === 0) {
    return (
      <CalmNote tone={statusColors.ship}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
          <span aria-hidden="true" style={{ display: "inline-flex", color: statusColors.ship }}>
            <CheckIcon size={13} />
          </span>
          You&rsquo;re all clear — nothing needs attention.
        </span>
      </CalmNote>
    );
  }
  const ordered = [...alerts].sort((a, b) => ALERT_SEVERITY_RANK[a.severity] - ALERT_SEVERITY_RANK[b.severity]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {ordered.map((alert, i) => (
        <AlertCard key={alert.id} alert={alert} pulse={i === 0 && alert.severity === "high"} onFollow={onFollow} />
      ))}
    </div>
  );
}

function AlertCard({ alert, pulse, onFollow }: { alert: OrientationAlertV1; pulse: boolean; onFollow?: (link: DeepLink) => void }) {
  const tone = ALERT_SEVERITY_TONES[alert.severity];
  return (
    <button
      type="button"
      className="cos-fx-row"
      onClick={onFollow ? () => onFollow(alert.deepLink) : undefined}
      title={alert.detail}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 5,
        padding: "10px 12px",
        textAlign: "left",
        width: "100%",
        minWidth: 0,
        background: tokens.card,
        border: `1px solid ${tokens.border}`,
        borderLeft: `3px solid ${tone}`,
        borderRadius: tokens.radiusSm,
        color: tokens.fg,
        font: "inherit",
        cursor: onFollow ? "pointer" : "default",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          aria-hidden="true"
          className={pulse ? "cos-fx-pulse-dot" : undefined}
          style={{ width: 8, height: 8, borderRadius: 999, background: tone, flex: "0 0 auto" }}
        />
        <Pill label={ALERT_KIND_LABELS[alert.kind]} tone={tone} />
        <span style={{ flex: 1 }} />
        <span aria-hidden="true" className="cos-fx-row-go" style={{ color: tone, fontSize: 15, lineHeight: 1 }}>
          →
        </span>
      </div>
      <span style={{ fontSize: 13, fontWeight: 600, color: tokens.fg, lineHeight: 1.3 }}>{alert.title}</span>
      <span
        style={{
          fontSize: 12,
          color: tokens.muted,
          lineHeight: 1.4,
          display: "-webkit-box",
          WebkitBoxOrient: "vertical",
          WebkitLineClamp: 2,
          overflow: "hidden",
        }}
      >
        {alert.detail}
      </span>
    </button>
  );
}
