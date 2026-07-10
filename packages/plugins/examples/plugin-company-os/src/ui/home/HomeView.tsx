/**
 * `HomeView` — the pure Orientation surface (spec §5.3): the default landing that
 * answers "where do I land, what needs me." It digests the `OrientationV1`
 * projection into six panels — a vitals strip, a pinned routine briefing, an
 * alert-worthy branch-health panel, a cross-session-work glance, a recent-commits
 * feed, and the unified attention rail — laid out as a vitals bar over a
 * two-column (main + rail) grid on desktop, a single prioritized column on
 * mobile. No SDK runtime: the connected `Home` injects data + the drawer slot, so
 * this renders identically under SSR (the Playwright harness) and live.
 */

import type { CSSProperties, ReactNode, Ref } from "react";
import type { BriefingCardV1, DeepLink, OrientationV1 } from "../../contracts/index.js";
import type { CompanyOsTabKey } from "../tabs.js";
import { tokens } from "../tokens.js";
import { CockpitSurfaceStyles } from "../shared/surface-styles.js";
import { StaleSourcePills } from "../shared/freshness.js";
import { ClockIcon, CloseIcon } from "../icons.js";
import { relativeTime } from "../shared/time.js";
import { CockpitMotionStyles } from "../shared/cockpit-motion.js";
import { DiagnosticsStrip } from "../shared/diagnostics-strip.js";
import { MetricsStrip } from "./MetricsStrip.js";
import { PinnedBriefing } from "./PinnedBriefing.js";
import { BranchHealthPanel } from "./BranchHealthPanel.js";
import { CrossSessionWork } from "./CrossSessionWork.js";
import { RecentCommitsGlance } from "./RecentCommitsGlance.js";
import { AlertsRail } from "./AlertsRail.js";

export interface HomeViewProps {
  orientation: OrientationV1;
  now: number;
  isMobile?: boolean;
  onOpenBriefing?: (card: BriefingCardV1) => void;
  onFollow?: (link: DeepLink) => void;
  onNavigateTab?: (key: CompanyOsTabKey) => void;
  /** When a briefing is open, the connected `Home` fills this with the viewer. */
  drawer?: ReactNode;
  /** Title for the open drawer (the briefing display name). */
  drawerTitle?: string | null;
  onCloseDrawer?: () => void;
  /** Focus-trap ref from the connected `Home`, placed on the drawer panel. */
  drawerRef?: Ref<HTMLDivElement>;
}

export function HomeView({
  orientation,
  now,
  isMobile = false,
  onOpenBriefing,
  onFollow,
  onNavigateTab,
  drawer,
  drawerTitle,
  onCloseDrawer,
  drawerRef,
}: HomeViewProps) {
  const derivedAge = relativeTime(orientation.derivedAt, now);

  const snapshot = (
    <Panel index={0} title="Snapshot" isMobile={isMobile}>
      <MetricsStrip metrics={orientation.metrics} isMobile={isMobile} onNavigateTab={onNavigateTab} />
      {/* B2: what degraded on this derive — the shared strip, right under the numbers it qualifies. */}
      <DiagnosticsStrip diagnostics={orientation.diagnostics} />
    </Panel>
  );
  const alerts = (
    <Panel index={1} title="Needs attention" count={orientation.alerts.length} isMobile={isMobile}>
      <AlertsRail alerts={orientation.alerts} onFollow={onFollow} />
    </Panel>
  );
  const briefing = (
    <Panel index={2} title="Today’s briefing" isMobile={isMobile}>
      <PinnedBriefing briefing={orientation.briefing} now={now} isMobile={isMobile} onOpen={onOpenBriefing} />
    </Panel>
  );
  const branches = (
    <Panel index={3} title="Branches needing attention" count={orientation.branchHealth.length} isMobile={isMobile}>
      <BranchHealthPanel count={orientation.branchHealth.length} onOpen={() => onNavigateTab?.("branch-pr")} />
    </Panel>
  );
  const work = (
    <Panel
      index={4}
      title="Cross-session work"
      count={orientation.recentWork.length}
      isMobile={isMobile}
      action={orientation.recentWork.length > 0 ? <SeeAll label="Atlas" onClick={() => onNavigateTab?.("atlas")} /> : undefined}
    >
      <CrossSessionWork recentWork={orientation.recentWork} taxonomy={orientation.taxonomy} now={now} isMobile={isMobile} onFollow={onFollow} />
    </Panel>
  );
  const commits = (
    <Panel
      index={5}
      title="Recent commits"
      count={orientation.recentCommits.length}
      isMobile={isMobile}
      action={orientation.recentCommits.length > 0 ? <SeeAll label="Branches" onClick={() => onNavigateTab?.("branch-pr")} /> : undefined}
    >
      <RecentCommitsGlance recentCommits={orientation.recentCommits} now={now} />
    </Panel>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
      <CockpitSurfaceStyles />
      <CockpitMotionStyles />

      {/* While the briefing drawer is open, hide the cockpit behind it from
          assistive tech. The drawer traps focus (keyboard users are already
          contained), so this only needs to keep the SR virtual cursor out of the
          background — aria-hidden is enough and universally supported. */}
      <div aria-hidden={drawer != null || undefined} style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
        <header style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 650, color: tokens.fg }}>Orientation</h2>
          {derivedAge ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: tokens.muted }}>
              <span aria-hidden="true" style={{ display: "inline-flex" }}>
                <ClockIcon size={12} />
              </span>
              as of {derivedAge}
            </span>
          ) : null}
          <StaleSourcePills sources={orientation.sources} />
        </header>

        {snapshot}

        {isMobile ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {alerts}
            {briefing}
            {branches}
            {work}
            {commits}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 324px", gap: 18, alignItems: "start" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
              {briefing}
              {branches}
              {work}
              {commits}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 18, position: "sticky", top: 12 }}>{alerts}</div>
          </div>
        )}
      </div>

      {drawer ? (
        <BriefingDrawer title={drawerTitle ?? null} isMobile={isMobile} onClose={onCloseDrawer} panelRef={drawerRef}>
          {drawer}
        </BriefingDrawer>
      ) : null}
    </div>
  );
}

function Panel({
  title,
  count,
  index,
  isMobile,
  action,
  children,
}: {
  title: string;
  count?: number;
  index: number;
  isMobile: boolean;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="cos-fx-enter"
      style={{ display: "flex", flexDirection: "column", gap: 11, minWidth: 0, animationDelay: `${index * 70}ms` }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span aria-hidden="true" style={{ width: 3, height: 14, borderRadius: 2, background: tokens.accent, transform: "translateY(2px)" }} />
        <h3 style={{ margin: 0, fontSize: isMobile ? 13.5 : 14, fontWeight: 650, letterSpacing: -0.2, color: tokens.fg }}>{title}</h3>
        {typeof count === "number" ? (
          <span style={{ fontSize: 12, color: tokens.muted, fontVariantNumeric: "tabular-nums" }}>{count}</span>
        ) : null}
        {action ? (
          <>
            <span style={{ flex: 1 }} />
            {action}
          </>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** A muted "see all → <tab>" panel affordance that switches tabs. */
function SeeAll({ label, onClick }: { label: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cos-fx-seeall"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 8px",
        borderRadius: 999,
        background: "transparent",
        border: "none",
        color: tokens.muted,
        font: "inherit",
        fontSize: 12,
        fontWeight: 550,
        cursor: onClick ? "pointer" : "default",
      }}
    >
      {label}
      <span aria-hidden="true">→</span>
    </button>
  );
}

/** A fixed overlay drawer for an opened briefing — scrim + a right-side reader. */
function BriefingDrawer({
  title,
  isMobile,
  onClose,
  panelRef,
  children,
}: {
  title: string | null;
  isMobile: boolean;
  onClose?: () => void;
  panelRef?: Ref<HTMLDivElement>;
  children: ReactNode;
}) {
  const scrim: CSSProperties = {
    position: "fixed",
    inset: 0,
    background: "rgba(0, 0, 0, 0.55)",
    border: "none",
    cursor: "pointer",
    zIndex: 40,
  };
  const panel: CSSProperties = {
    position: "fixed",
    top: 0,
    right: 0,
    bottom: 0,
    width: isMobile ? "100%" : "min(560px, 92vw)",
    background: tokens.bg,
    borderLeft: `1px solid ${tokens.border}`,
    boxShadow: "-24px 0 60px -30px rgba(0,0,0,0.7)",
    zIndex: 41,
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
  };
  return (
    <div role="dialog" aria-modal="true" aria-label={title ?? "Briefing"}>
      <button type="button" aria-label="Close" className="cos-fx-scrim" style={scrim} onClick={onClose} />
      <div ref={panelRef} className="cos-fx-drawer" style={panel}>
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "14px 18px",
            borderBottom: `1px solid ${tokens.border}`,
            flex: "0 0 auto",
          }}
        >
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: tokens.muted }}>
            Briefing
          </span>
          <span style={{ flex: 1 }} />
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close briefing"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 30,
                height: 30,
                borderRadius: tokens.radiusSm,
                background: tokens.secondary,
                border: `1px solid ${tokens.border}`,
                color: tokens.muted,
                cursor: "pointer",
              }}
            >
              <CloseIcon size={14} />
            </button>
          ) : null}
        </header>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: isMobile ? 16 : 22 }}>{children}</div>
      </div>
    </div>
  );
}
