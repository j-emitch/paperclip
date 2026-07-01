import {
  useHostNavigation,
  type PluginPageProps,
  type PluginRouteSidebarProps,
  type PluginSidebarProps,
} from "@paperclipai/plugin-sdk/ui";
import type { CSSProperties } from "react";
import { COMPANY_OS_ROUTE } from "../manifest.js";
import { tokens, springTransition } from "./tokens.js";
import { COMPANY_OS_TABS, type CompanyOsTab } from "./tabs.js";
import { TAB_ICONS, CompanyOsGlyph } from "./icons.js";
import { useActiveTab, usePersistedTabHydration } from "./active-tab-store.js";
import { useIsMobile } from "./hooks/useMediaQuery.js";
import { CompanyOsBoard } from "./board/CompanyOsBoard.js";
import { Home } from "./home/Home.js";
import { Source } from "./source/Source.js";
import { Docs } from "./docs/Docs.js";
import { Agents } from "./agents/Agents.js";
import { Skills } from "./skills/Skills.js";

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
  usePersistedTabHydration();
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
            {tab.placeholder ? <PhasePill label={tab.liveIn} muted /> : null}
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
  usePersistedTabHydration();
  const current = COMPANY_OS_TABS.find((tab) => tab.key === activeTab) ?? COMPANY_OS_TABS[0];
  // The live surfaces own their own panel chrome; placeholders sit inside a card.
  const isLive =
    current.key === "home" ||
    current.key === "source" ||
    current.key === "board" ||
    current.key === "docs" ||
    current.key === "agents" ||
    current.key === "skills";

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
        role="tabpanel"
        id={`cos-panel-${current.key}`}
        aria-labelledby={`cos-tab-${current.key}`}
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
  // board/docs/routines can never flash under another's id.
  const key = companyId ?? "_no_company";
  switch (tabKey) {
    case "board":
      return <CompanyOsBoard key={key} companyId={companyId} />;
    case "docs":
      return <Docs key={key} companyId={companyId} />;
    case "agents":
      return <Agents key={key} companyId={companyId} />;
    case "skills":
      return <Skills key={key} companyId={companyId} />;
    case "home":
      return <Home key={key} companyId={companyId} />;
    case "source":
      return <Source key={key} companyId={companyId} />;
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
            id={`cos-tab-${tab.key}`}
            aria-selected={selected}
            aria-controls={selected ? `cos-panel-${tab.key}` : undefined}
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
            {tab.placeholder ? <PhasePill label="Soon" muted /> : null}
          </button>
        );
      })}
    </div>
  );
}

function PlaceholderPanel({ tab }: { tab: CompanyOsTab }) {
  const Icon = TAB_ICONS[tab.key];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
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

function PhasePill({ label, muted = false }: { label: string; muted?: boolean }) {
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
