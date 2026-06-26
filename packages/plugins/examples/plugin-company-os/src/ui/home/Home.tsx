/**
 * `Home` — the data-connected Orientation tab (the cockpit's default landing).
 * Owns the `orientation` fetch, the shared cold/error/empty states, the
 * briefing-drawer selection + its connected `report-content` read + focus trap,
 * and the navigation glue that turns a typed `DeepLink` / a metric tile into a tab
 * switch (and a pending target the destination surface consumes). Everything
 * visual is delegated to the pure `HomeView`; the markdown body is the host
 * `<MarkdownBlock>`, injected only here so the view stays bridge-free.
 *
 * Selection + drawer reset when the company changes (one company's open briefing
 * never leaks to another); the connected viewer mounts only while a briefing is
 * open, so no `report-content` fetch fires for an empty selection.
 */

import { useCallback, useEffect, useState } from "react";
import { MarkdownBlock } from "@paperclipai/plugin-sdk/ui";
import type { BriefingCardV1, DeepLink } from "../../contracts/index.js";
import { HomeIcon } from "../icons.js";
import { type CompanyOsTabKey } from "../tabs.js";
import { useActiveTab } from "../active-tab-store.js";
import { setPendingTarget } from "../pending-target-store.js";
import { SurfaceEmpty, SurfaceError, SurfaceLoading } from "../shared/surface-state.js";
import { useOrientation } from "../hooks/useOrientation.js";
import { useReportContent } from "../hooks/useReportContent.js";
import { useIsMobile } from "../hooks/useMediaQuery.js";
import { useNow } from "../hooks/useNow.js";
import { useFocusTrap } from "../hooks/useFocusTrap.js";
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

  const onOpenBriefing = useCallback((card: BriefingCardV1) => setOpenBriefing(card), []);
  const onCloseDrawer = useCallback(() => setOpenBriefing(null), []);
  const onNavigateTab = useCallback((key: CompanyOsTabKey) => setTab(key), [setTab]);
  // A deep-link both switches the tab AND records a one-shot target the
  // destination surface consumes (Source expands the branch, Docs selects the doc).
  const onFollow = useCallback(
    (link: DeepLink) => {
      setPendingTarget(link);
      setTab(deepLinkTabKey(link));
    },
    [setTab],
  );

  // Trap + restore focus while the briefing drawer is open (Escape closes it).
  const drawerRef = useFocusTrap<HTMLDivElement>(openBriefing !== null, onCloseDrawer);

  if (loading && !orientation) return <SurfaceLoading label="Orienting…" />;
  if (error && !orientation) return <SurfaceError message={error.message} onRetry={refresh} />;
  if (!orientation) {
    return (
      <SurfaceEmpty
        icon={<HomeIcon size={24} />}
        title="Your cockpit is warming up"
        body="The orientation digest — your briefing, branch health, and what needs attention — appears here on the next derive."
        onRefresh={companyId ? refresh : undefined}
      />
    );
  }

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
      drawerRef={drawerRef}
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
