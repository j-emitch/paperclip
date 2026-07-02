/**
 * The reserved-tab placeholder panel + its phase pill — the "arrives in COS-N"
 * card a not-yet-live tab shows. Extracted from `app.tsx` so BOTH the live app
 * AND the COS-2f `render-slot` (the flag-off byte-identity snapshot) render the
 * EXACT same markup: that identity is what proves a flag-gated tab is truly
 * dormant when off (its enabling code adds nothing to the rendered slot).
 */

import type { CSSProperties } from "react";
import { tokens } from "../tokens.js";
import { TAB_ICONS } from "../icons.js";
import type { CompanyOsTab } from "../tabs.js";

export function PlaceholderPanel({ tab }: { tab: CompanyOsTab }) {
  const Icon = TAB_ICONS[tab.key];
  return (
    <div role="tabpanel" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 650 }}>{tab.label}</h2>
        <PhasePill label={`live in ${tab.liveIn}`} />
      </div>
      <p style={{ margin: 0, fontSize: 14, color: tokens.muted, maxWidth: 640, lineHeight: 1.5 }}>
        {tab.description}
      </p>
      <div
        style={{
          border: `1px dashed ${tokens.border}`,
          borderRadius: tokens.radius,
          padding: 20,
          background: tokens.bg,
          color: tokens.muted,
          fontSize: 13,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <span aria-hidden="true" style={{ color: tokens.accent, display: "inline-flex" }}>
          <Icon size={20} />
        </span>
        <span>
          <strong style={{ color: tokens.fg, fontWeight: 600 }}>{tab.label}</strong> arrives in{" "}
          <code style={{ fontFamily: tokens.mono, color: tokens.fg }}>{tab.liveIn}</code>.
        </span>
      </div>
    </div>
  );
}

export function PhasePill({ label, muted = false }: { label: string; muted?: boolean }) {
  const style: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    padding: "2px 8px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: 0.2,
    fontFamily: tokens.mono,
    color: muted ? tokens.muted : tokens.accent,
    background: muted ? tokens.secondary : tokens.accentSoft,
    border: `1px solid ${muted ? tokens.border : tokens.accentBorder}`,
  };
  return <span style={style}>{label}</span>;
}
