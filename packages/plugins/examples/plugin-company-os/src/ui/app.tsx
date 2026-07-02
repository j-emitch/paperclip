import {
  useHostNavigation,
  type PluginPageProps,
  type PluginRouteSidebarProps,
  type PluginSidebarProps,
} from "@paperclipai/plugin-sdk/ui";
import { COMPANY_OS_ROUTE } from "../manifest.js";
import { isTeachingTabEnabled } from "./flags.js";
import { tokens, springTransition } from "./tokens.js";
import { COMPANY_OS_TABS, type CompanyOsTab, type CompanyOsTabKey } from "./tabs.js";
import { TAB_ICONS, CompanyOsGlyph } from "./icons.js";
import { useActiveTab } from "./active-tab-store.js";
import { useIsMobile } from "./hooks/useMediaQuery.js";
import { CompanyOsBoard } from "./board/CompanyOsBoard.js";
import { Reports } from "./reports/Reports.js";
import { Routines } from "./routines/Routines.js";
import { Teaching } from "./teaching/Teaching.js";
import { PlaceholderPanel, PhasePill } from "./shared/placeholder-panel.js";

/**
 * Which tabs own their panel chrome (live surfaces) vs. sit inside a placeholder
 * card. COS-2f: `teaching` is live ONLY behind `COS_TEACHING_TAB_ENABLED`, so the
 * cockpit is byte-identical (the COS-0 placeholder) when the flag is off. The
 * single predicate drives the panel switch, the header chrome, and the phase pill,
 * so they can't drift.
 */
function tabIsLive(key: CompanyOsTabKey): boolean {
  if (key === "teaching") return isTeachingTabEnabled();
  return key === "board" || key === "reports" || key === "routines";
}

/** A tab shows its "live in COS-N" phase pill when it is reserved AND not yet live. */
function tabShowsPhasePill(tab: CompanyOsTab): boolean {
  return tab.placeholder === true && !tabIsLive(tab.key);
}

// ---------------------------------------------------------------------------
// Sidebar entry — top-level nav link into the cockpit.
// ---------------------------------------------------------------------------

export function SidebarLink(_props: PluginSidebarProps) {
  const hostNavigation = useHostNavigation();
  return (
    <a
      {...hostNavigation.linkProps(`/${COMPANY_OS_ROUTE}`)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 12px",
        fontSize: 13,
        fontWeight: 500,
        color: tokens.fg,
        textDecoration: "none",
        borderRadius: tokens.radiusSm,
        transition: springTransition,
      }}
    >
      <span aria-hidden="true" style={{ color: tokens.accent, display: "inline-flex" }}>
        <CompanyOsGlyph size={16} />
      </span>
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        Company OS
      </span>
    </a>
  );
}

// ---------------------------------------------------------------------------
// Route sidebar — vertical tab nav, kept in lockstep with the page via the
// shared active-tab store.
// ---------------------------------------------------------------------------

export function CompanyOsRouteSidebar(_props: PluginRouteSidebarProps) {
  const [activeTab, setTab] = useActiveTab();
  return (
    <nav
      aria-label="Company OS sections"
      style={{ display: "flex", flexDirection: "column", gap: 2, padding: 12, fontFamily: tokens.font }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: 0.6,
          textTransform: "uppercase",
          color: tokens.muted,
          padding: "6px 10px 8px",
        }}
      >
        Cockpit
      </div>
      {COMPANY_OS_TABS.map((tab) => {
        const Icon = TAB_ICONS[tab.key];
        const selected = tab.key === activeTab;
        return (
          <button
            key={tab.key}
            type="button"
            aria-current={selected ? "page" : undefined}
            onClick={() => setTab(tab.key)}
            title={tab.description}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 10px",
              border: "none",
              borderRadius: tokens.radiusSm,
              background: selected ? tokens.accentSoft : "transparent",
              color: selected ? tokens.fg : tokens.muted,
              font: "inherit",
              fontSize: 13,
              fontWeight: selected ? 600 : 500,
              cursor: "pointer",
              textAlign: "left",
              width: "100%",
              transition: springTransition,
            }}
          >
            <span aria-hidden="true" style={{ display: "inline-flex", color: selected ? tokens.accent : tokens.muted }}>
              <Icon size={16} />
            </span>
            <span style={{ flex: 1 }}>{tab.label}</span>
            {tabShowsPhasePill(tab) ? <PhasePill label={tab.liveIn} muted /> : null}
          </button>
        );
      })}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Main page — header + tab bar + active panel.
// ---------------------------------------------------------------------------

export function CompanyOsPage({ context }: PluginPageProps) {
  const isMobile = useIsMobile();
  const [activeTab, setTab] = useActiveTab();
  const current = COMPANY_OS_TABS.find((tab) => tab.key === activeTab) ?? COMPANY_OS_TABS[0];
  // The live surfaces own their own panel chrome; placeholders sit inside a card.
  const isLive = tabIsLive(current.key);

  return (
    <main
      style={{
        padding: isMobile ? 16 : 24,
        maxWidth: 1180,
        margin: "0 auto",
        minWidth: 0,
        fontFamily: tokens.font,
        color: tokens.fg,
        display: "flex",
        flexDirection: "column",
        gap: isMobile ? 16 : 20,
      }}
    >
      <Header isMobile={isMobile} />

      <TabBar isMobile={isMobile} activeKey={activeTab} onSelect={setTab} />

      <section
        aria-live="polite"
        style={{
          background: isLive ? "transparent" : tokens.card,
          border: isLive ? "none" : `1px solid ${tokens.border}`,
          borderRadius: tokens.radius,
          padding: isLive ? 0 : isMobile ? 16 : 24,
        }}
      >
        <TabPanel tabKey={current.key} companyId={context.companyId} tab={current} />
      </section>
    </main>
  );
}

function TabPanel({
  tabKey,
  companyId,
  tab,
}: {
  tabKey: CompanyOsTab["key"];
  companyId: string | null;
  tab: CompanyOsTab;
}) {
  // Key the live surfaces by companyId so switching companies REMOUNTS them —
  // `usePluginData` keeps the prior company's data while the next request is in
  // flight (stale-while-revalidate), and a remount clears it so one company's
  // board/reports/routines can never flash under another's id.
  const key = companyId ?? "_no_company";
  switch (tabKey) {
    case "board":
      return <CompanyOsBoard key={key} companyId={companyId} />;
    case "reports":
      return <Reports key={key} companyId={companyId} />;
    case "routines":
      return <Routines key={key} companyId={companyId} />;
    case "teaching":
      // COS-2f: live only behind the flag; otherwise the untouched placeholder.
      return tabIsLive("teaching") ? <Teaching key={key} companyId={companyId} /> : <PlaceholderPanel tab={tab} />;
    default:
      return <PlaceholderPanel tab={tab} />;
  }
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function Header({ isMobile }: { isMobile: boolean }) {
  return (
    <header style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
      <span
        aria-hidden="true"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 40,
          height: 40,
          borderRadius: tokens.radius,
          background: tokens.accentSoft,
          border: `1px solid ${tokens.accentBorder}`,
          color: tokens.accent,
        }}
      >
        <CompanyOsGlyph size={22} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h1 style={{ margin: 0, fontSize: isMobile ? 20 : 24, fontWeight: 700, letterSpacing: -0.4 }}>
          Company OS
        </h1>
        <p style={{ margin: "2px 0 0", fontSize: 13, color: tokens.muted }}>
          Owner / developer cockpit — build, architecture, and review at a glance.
        </p>
      </div>
    </header>
  );
}

function TabBar({
  isMobile,
  activeKey,
  onSelect,
}: {
  isMobile: boolean;
  activeKey: string;
  onSelect: (key: CompanyOsTab["key"]) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Company OS tabs"
      style={{
        display: "flex",
        gap: 6,
        overflowX: "auto",
        paddingBottom: 4,
        borderBottom: `1px solid ${tokens.border}`,
      }}
    >
      {COMPANY_OS_TABS.map((tab) => {
        const Icon = TAB_ICONS[tab.key];
        const selected = tab.key === activeKey;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onSelect(tab.key)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: isMobile ? "8px 12px" : "9px 14px",
              border: "none",
              borderBottom: `2px solid ${selected ? tokens.accent : "transparent"}`,
              background: "transparent",
              color: selected ? tokens.fg : tokens.muted,
              font: "inherit",
              fontSize: 13,
              fontWeight: selected ? 600 : 500,
              cursor: "pointer",
              whiteSpace: "nowrap",
              transition: springTransition,
            }}
          >
            <span aria-hidden="true" style={{ display: "inline-flex", color: selected ? tokens.accent : tokens.muted }}>
              <Icon size={16} />
            </span>
            {tab.label}
            {tabShowsPhasePill(tab) ? <PhasePill label="Soon" muted /> : null}
          </button>
        );
      })}
    </div>
  );
}

// `PlaceholderPanel` + `PhasePill` moved to ./shared/placeholder-panel.js so the
// COS-2f render-slot (flag-off byte-identity snapshot) renders the identical tree.
