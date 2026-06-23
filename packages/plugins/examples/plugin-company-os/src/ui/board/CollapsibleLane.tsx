/**
 * The shared collapsible-lane shell used by both `Swimlane` and `UnclassifiedLane`.
 * Centralizes the header button (caret + title slot + trailing slot), keyboard +
 * focus affordances, overflow constraints, and the a11y contract: `aria-expanded`
 * always reflects state, and `aria-controls` is set ONLY when the body is mounted
 * (so it never dangles at an unmounted node). Extracting this keeps the two lane
 * variants from drifting on focus / padding / overflow / aria.
 */

import type { CSSProperties, ReactNode } from "react";
import { tokens } from "../tokens.js";
import { CaretIcon } from "../icons.js";

export function CollapsibleLane({
  laneId,
  collapsed,
  onToggle,
  isMobile,
  borderColor = tokens.border,
  header,
  trailing,
  toggleLabel,
  children,
}: {
  laneId: string;
  collapsed: boolean;
  onToggle: (laneId: string) => void;
  isMobile: boolean;
  borderColor?: string;
  header: ReactNode;
  trailing: ReactNode;
  toggleLabel?: string;
  children: ReactNode;
}) {
  const bodyId = `cos-lane-${laneId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  return (
    <section
      className="cos-lane"
      style={{ background: tokens.card, border: `1px solid ${borderColor}`, borderRadius: tokens.radius, overflow: "hidden" }}
    >
      <button
        type="button"
        className="cos-collapse"
        onClick={() => onToggle(laneId)}
        aria-expanded={!collapsed}
        aria-controls={collapsed ? undefined : bodyId}
        aria-label={toggleLabel}
        style={headerStyle(isMobile)}
      >
        <span className="cos-caret" data-collapsed={collapsed} aria-hidden="true" style={{ color: tokens.muted, flex: "0 0 auto" }}>
          <CaretIcon size={15} />
        </span>
        <span style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8, overflow: "hidden" }}>{header}</span>
        <span style={{ flex: "0 0 auto" }}>{trailing}</span>
      </button>
      {collapsed ? null : (
        <div id={bodyId} style={{ padding: isMobile ? "0 13px 12px" : "0 16px 14px" }}>
          {children}
        </div>
      )}
    </section>
  );
}

function headerStyle(isMobile: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: isMobile ? "11px 13px" : "12px 16px",
    border: "none",
    background: "transparent",
    color: tokens.fg,
    font: "inherit",
    cursor: "pointer",
    textAlign: "left",
  };
}
