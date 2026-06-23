import {
  Spinner,
  usePluginData,
  useHostNavigation,
  type PluginPageProps,
  type PluginRouteSidebarProps,
  type PluginSidebarProps,
} from "@paperclipai/plugin-sdk/ui";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { COMPANY_OS_ROUTE } from "../manifest.js";
import { tokens, mobileMediaQuery, springTransition } from "./tokens.js";
import { COMPANY_OS_TABS, type CompanyOsTab } from "./tabs.js";
import { TAB_ICONS, CompanyOsGlyph } from "./icons.js";
import { useActiveTab } from "./active-tab-store.js";

// ---------------------------------------------------------------------------
// Worker data shape (kept local so the UI never imports worker/runtime code —
// the import-boundary the board UI hardens in COS-0e).
// ---------------------------------------------------------------------------

interface ScaffoldStatusData {
  ok?: boolean;
  phase?: string;
  message?: string;
  upcoming?: { tab: string; liveIn: string }[];
}

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(mobileMediaQuery);
    const update = () => setIsMobile(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);
  return isMobile;
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
  const { data, loading, error } = usePluginData<ScaffoldStatusData>("scaffold-status", {
    companyId: context.companyId,
  });
  const current = COMPANY_OS_TABS.find((tab) => tab.key === activeTab) ?? COMPANY_OS_TABS[0];

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
      <Header isMobile={isMobile} loading={loading} ok={data?.ok === true} errored={error !== null} />

      <TabBar isMobile={isMobile} activeKey={activeTab} onSelect={setTab} />

      <section
        aria-live="polite"
        style={{
          background: tokens.card,
          border: `1px solid ${tokens.border}`,
          borderRadius: tokens.radius,
          padding: isMobile ? 16 : 24,
        }}
      >
        <TabPanel tab={current} status={data} loading={loading} errored={error !== null} />
      </section>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function Header({
  isMobile,
  loading,
  ok,
  errored,
}: {
  isMobile: boolean;
  loading: boolean;
  ok: boolean;
  errored: boolean;
}) {
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
      <WorkerStatusPill loading={loading} ok={ok} errored={errored} />
    </header>
  );
}

function WorkerStatusPill({ loading, ok, errored }: { loading: boolean; ok: boolean; errored: boolean }) {
  const { label, dot } = errored
    ? { label: "Worker offline", dot: "oklch(0.62 0.21 25)" }
    : loading
      ? { label: "Connecting…", dot: tokens.muted }
      : ok
        ? { label: "Scaffold live", dot: "oklch(0.7 0.16 145)" }
        : { label: "Idle", dot: tokens.muted };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        padding: "5px 11px",
        borderRadius: 999,
        background: tokens.secondary,
        border: `1px solid ${tokens.border}`,
        fontSize: 12,
        fontWeight: 500,
        color: tokens.fg,
      }}
    >
      {loading ? (
        <Spinner size="sm" />
      ) : (
        <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: dot }} />
      )}
      {label}
    </span>
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
            {tab.placeholder ? <PhasePill label="Soon" muted /> : null}
          </button>
        );
      })}
    </div>
  );
}

function TabPanel({
  tab,
  status,
  loading,
  errored,
}: {
  tab: CompanyOsTab;
  status: ScaffoldStatusData | null;
  loading: boolean;
  errored: boolean;
}) {
  return (
    <div role="tabpanel" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 650 }}>{tab.label}</h2>
        <PhasePill label={`live in ${tab.liveIn}`} />
      </div>
      <p style={{ margin: 0, fontSize: 14, color: tokens.muted, maxWidth: 640, lineHeight: 1.5 }}>
        {tab.description}
      </p>

      <Placeholder tab={tab} />

      {tab.key === "board" ? (
        <WorkerBanner status={status} loading={loading} errored={errored} />
      ) : null}
    </div>
  );
}

function Placeholder({ tab }: { tab: CompanyOsTab }) {
  return (
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
        {(() => {
          const Icon = TAB_ICONS[tab.key];
          return <Icon size={20} />;
        })()}
      </span>
      <span>
        <strong style={{ color: tokens.fg, fontWeight: 600 }}>{tab.label}</strong> arrives in{" "}
        <code style={{ fontFamily: tokens.mono, color: tokens.fg }}>{tab.liveIn}</code>. This scaffold
        proves the plugin installs, routes, and renders inside Paperclip.
      </span>
    </div>
  );
}

function WorkerBanner({
  status,
  loading,
  errored,
}: {
  status: ScaffoldStatusData | null;
  loading: boolean;
  errored: boolean;
}) {
  let body: ReactNode;
  if (errored) {
    body = (
      <span style={{ color: "oklch(0.78 0.13 25)" }}>
        Could not reach the plugin worker. Check the host plugin logs.
      </span>
    );
  } else if (loading) {
    body = (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: tokens.muted }}>
        <Spinner size="sm" /> Contacting the worker…
      </span>
    );
  } else if (status?.message) {
    body = <span style={{ color: tokens.fg }}>{status.message}</span>;
  } else {
    body = <span style={{ color: tokens.muted }}>Worker idle.</span>;
  }
  return (
    <div
      style={{
        marginTop: 4,
        padding: "12px 14px",
        borderRadius: tokens.radiusSm,
        background: tokens.accentSoft,
        border: `1px solid ${tokens.accentBorder}`,
        fontSize: 13,
      }}
    >
      {body}
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
