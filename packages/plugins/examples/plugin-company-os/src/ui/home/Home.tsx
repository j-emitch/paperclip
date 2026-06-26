/**
 * `Home` — the data-connected Orientation tab (the cockpit's default landing).
 * Owns the `orientation` fetch, the cold/error/empty states, the briefing-drawer
 * selection + its connected `report-content` read, and the navigation glue that
 * turns a typed `DeepLink` / a metric tile into a tab switch on the shared
 * active-tab store. Everything visual is delegated to the pure `HomeView`; the
 * markdown body is the host `<MarkdownBlock>`, injected only here so the view
 * stays bridge-free + SSR-screenshottable.
 *
 * Selection + drawer reset when the company changes (one company's open briefing
 * never leaks to another), and the connected viewer mounts only while a briefing
 * is open, so no `report-content` fetch fires for an empty selection.
 */

import { useCallback, useEffect, useState } from "react";
import { MarkdownBlock } from "@paperclipai/plugin-sdk/ui";
import type { BriefingCardV1, DeepLink } from "../../contracts/index.js";
import { tokens } from "../tokens.js";
import { Frame, Glyph, LocalSpinner, ghostButtonStyle } from "../shared/feedback.js";
import { AlertIcon, HomeIcon, RefreshIcon } from "../icons.js";
import { type CompanyOsTabKey } from "../tabs.js";
import { useActiveTab } from "../active-tab-store.js";
import { useOrientation } from "../hooks/useOrientation.js";
import { useReportContent } from "../hooks/useReportContent.js";
import { useIsMobile } from "../hooks/useMediaQuery.js";
import { useNow } from "../hooks/useNow.js";
import { ReportViewerPanel } from "../reports/ReportViewerPanel.js";
import { HomeView } from "./HomeView.js";

/** Production markdown slot — host renderer, wikilinks on, raw HTML inert (react-markdown). */
function renderHostMarkdown(markdown: string) {
  return <MarkdownBlock content={markdown} enableWikiLinks />;
}

/**
 * Map a typed deep-link to the tab that hosts its target. `docs` lands on the
 * `reports` key until the 1h `reports→docs` rename (the Docs surface already
 * lives on that key post-1g); `source`/`board` are stable.
 */
function deepLinkTabKey(link: DeepLink): CompanyOsTabKey {
  switch (link.tab) {
    case "source":
      return "source";
    case "board":
      return "board";
    case "docs":
      return "reports";
  }
}

export function Home({ companyId }: { companyId: string | null }) {
  const isMobile = useIsMobile();
  const now = useNow();
  const { orientation, loading, error, refresh } = useOrientation(companyId);
  const [, setTab] = useActiveTab();
  const [openBriefing, setOpenBriefing] = useState<BriefingCardV1 | null>(null);

  // Reset the open briefing when the active company changes.
  useEffect(() => {
    setOpenBriefing(null);
  }, [companyId]);

  // Escape closes the briefing drawer.
  useEffect(() => {
    if (!openBriefing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenBriefing(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openBriefing]);

  const onOpenBriefing = useCallback((card: BriefingCardV1) => setOpenBriefing(card), []);
  const onCloseDrawer = useCallback(() => setOpenBriefing(null), []);
  const onNavigateTab = useCallback((key: CompanyOsTabKey) => setTab(key), [setTab]);
  const onFollow = useCallback((link: DeepLink) => setTab(deepLinkTabKey(link)), [setTab]);

  if (loading && !orientation) return <HomeLoading />;
  if (error && !orientation) return <HomeError message={error.message} onRetry={refresh} />;
  if (!orientation) return <HomeEmpty onRefresh={companyId ? refresh : undefined} />;

  const drawer =
    openBriefing && openBriefing.relPath !== null ? (
      <ConnectedBriefingViewer
        key={`${openBriefing.repo}:${openBriefing.relPath}`}
        companyId={companyId}
        repo={openBriefing.repo}
        relPath={openBriefing.relPath}
        now={now}
        isMobile={isMobile}
      />
    ) : null;

  return (
    <HomeView
      orientation={orientation}
      now={now}
      isMobile={isMobile}
      onOpenBriefing={onOpenBriefing}
      onFollow={onFollow}
      onNavigateTab={onNavigateTab}
      drawer={drawer}
      drawerTitle={openBriefing?.displayName ?? null}
      onCloseDrawer={onCloseDrawer}
    />
  );
}

function ConnectedBriefingViewer({
  companyId,
  repo,
  relPath,
  now,
  isMobile,
}: {
  companyId: string | null;
  repo: string;
  relPath: string;
  now: number;
  isMobile: boolean;
}) {
  const { content, loading, error, refresh } = useReportContent(companyId, repo, relPath);
  return (
    <ReportViewerPanel
      content={content}
      loading={loading}
      error={error ? error.message : null}
      now={now}
      isMobile={isMobile}
      renderMarkdown={renderHostMarkdown}
      onRetry={refresh}
    />
  );
}

// --- tab-level states (cold cache / worker error / not-yet-derived) ----------

function HomeLoading() {
  return (
    <Frame>
      <LocalSpinner />
      <p style={{ margin: 0, fontSize: 14, color: tokens.muted }} aria-live="polite">
        Orienting…
      </p>
    </Frame>
  );
}

function HomeError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Frame>
      <Glyph tone="oklch(0.64 0.21 25)">
        <AlertIcon size={24} />
      </Glyph>
      <div>
        <p style={{ margin: 0, fontSize: 15, fontWeight: 650, color: tokens.fg }}>Couldn’t reach the worker</p>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: tokens.muted, maxWidth: 380 }}>{message}</p>
      </div>
      <button type="button" onClick={onRetry} style={ghostButtonStyle}>
        <span aria-hidden="true" style={{ display: "inline-flex" }}>
          <RefreshIcon size={14} />
        </span>
        Try again
      </button>
    </Frame>
  );
}

function HomeEmpty({ onRefresh }: { onRefresh?: () => void }) {
  return (
    <Frame>
      <Glyph tone={tokens.accent}>
        <HomeIcon size={24} />
      </Glyph>
      <div>
        <p style={{ margin: 0, fontSize: 15, fontWeight: 650, color: tokens.fg }}>Your cockpit is warming up</p>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: tokens.muted, maxWidth: 420, lineHeight: 1.5 }}>
          The orientation digest — your briefing, branch health, and what needs attention — appears here on the next derive.
        </p>
      </div>
      {onRefresh ? (
        <button type="button" onClick={onRefresh} style={ghostButtonStyle}>
          <span aria-hidden="true" style={{ display: "inline-flex" }}>
            <RefreshIcon size={14} />
          </span>
          Refresh
        </button>
      ) : null}
    </Frame>
  );
}
