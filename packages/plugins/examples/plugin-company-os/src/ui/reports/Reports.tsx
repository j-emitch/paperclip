/**
 * `Reports` — the artifact-index browser. NOTE: this is NOT a routed cockpit tab.
 * The Docs surface (COS-1g) superseded the old Reports tab; `app.tsx` routes the
 * `docs` key to `<Docs>`, so this connected container is never mounted. It is
 * RETAINED as the working reference consumer of the still-live `artifact-index`
 * seam (ArtifactSource walks `docs/teachings/**` into `cos_artifact_index`; COS-2
 * Teaching is its declared next consumer) — it stays compile-checked + type-aligned
 * to `ArtifactIndexV1` at zero runtime cost. Do not mistake it for the Docs tab.
 *
 * Owns the artifact-index fetch, the filter + selection state, and the live
 * `report-content` read for a selected doc. Visuals delegate to the pure
 * `ReportsView` + the shared `DocumentViewerPanel`; the markdown body is the host
 * `<MarkdownBlock>`, injected only here so the pure views stay bridge-free.
 * Selection resets when the company changes; the viewer mounts only when a doc is
 * selected, so no `report-content` fetch fires for an empty selection.
 */

import { useCallback, useEffect, useState } from "react";
import { MarkdownBlock } from "@paperclipai/plugin-sdk/ui";
import type { ArtifactEntry } from "../../contracts/index.js";
import { tokens } from "../tokens.js";
import { Frame, Glyph, LocalSpinner, ghostButtonStyle } from "../shared/feedback.js";
import { AlertIcon, DocIcon, RefreshIcon } from "../icons.js";
import { useArtifactIndex } from "../hooks/useArtifactIndex.js";
import { useReportContent } from "../hooks/useReportContent.js";
import { useIsMobile } from "../hooks/useMediaQuery.js";
import { useNow } from "../hooks/useNow.js";
import { ReportsView } from "./ReportsView.js";
import { DocumentViewerPanel } from "../shared/DocumentViewerPanel.js";
import { EMPTY_FILTER, selectionKey, type ReportsFilter } from "./reports-view-model.js";

/** Production markdown slot — host renderer, wikilinks on, raw HTML inert (react-markdown). */
function renderHostMarkdown(markdown: string) {
  return <MarkdownBlock content={markdown} enableWikiLinks />;
}

export function Reports({ companyId }: { companyId: string | null }) {
  const isMobile = useIsMobile();
  const now = useNow();
  const { index, loading, error, refresh } = useArtifactIndex(companyId);

  const [filter, setFilter] = useState<ReportsFilter>(() => ({ ...EMPTY_FILTER }));
  const [selected, setSelected] = useState<ArtifactEntry | null>(null);

  // Reset filter + selection when the active company changes.
  useEffect(() => {
    setSelected(null);
    setFilter({ ...EMPTY_FILTER });
  }, [companyId]);

  const onSelect = useCallback((entry: ArtifactEntry) => setSelected(entry), []);
  const onClose = useCallback(() => setSelected(null), []);

  if (loading && !index) return <ReportsLoading />;
  if (error && !index) return <ReportsError message={error.message} onRetry={refresh} />;
  if (!index || index.entries.length === 0) return <ReportsEmpty onRefresh={companyId ? refresh : undefined} />;

  const viewer = selected ? (
    <ConnectedReportViewer
      // Remount on selection change so the viewer resets to its spinner instead
      // of leaving the previous document visible while the next one loads
      // (usePluginData keeps prior content during the in-flight fetch).
      key={selectionKey(selected)}
      companyId={companyId}
      repo={selected.repo}
      relPath={selected.relPath}
      now={now}
      isMobile={isMobile}
      onClose={isMobile ? onClose : undefined}
    />
  ) : (
    <DocumentViewerPanel content={null} loading={false} error={null} now={now} isMobile={isMobile} renderMarkdown={renderHostMarkdown} />
  );

  return (
    <ReportsView
      index={index}
      filter={filter}
      onFilterChange={setFilter}
      selectedKey={selected ? selectionKey(selected) : null}
      onSelect={onSelect}
      now={now}
      isMobile={isMobile}
      viewer={viewer}
    />
  );
}

function ConnectedReportViewer({
  companyId,
  repo,
  relPath,
  now,
  isMobile,
  onClose,
}: {
  companyId: string | null;
  repo: string;
  relPath: string;
  now: number;
  isMobile: boolean;
  onClose?: () => void;
}) {
  const { content, loading, error, refresh } = useReportContent(companyId, repo, relPath);
  return (
    <DocumentViewerPanel
      content={content}
      loading={loading}
      error={error ? error.message : null}
      now={now}
      isMobile={isMobile}
      renderMarkdown={renderHostMarkdown}
      onRetry={refresh}
      onClose={onClose}
    />
  );
}

// --- tab-level states (cold cache / worker error / empty workspace) ----------

function ReportsLoading() {
  return (
    <Frame>
      <LocalSpinner />
      <p style={{ margin: 0, fontSize: 14, color: tokens.muted }} aria-live="polite">
        Loading the report index…
      </p>
    </Frame>
  );
}

function ReportsError({ message, onRetry }: { message: string; onRetry: () => void }) {
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

function ReportsEmpty({ onRefresh }: { onRefresh?: () => void }) {
  return (
    <Frame>
      <Glyph tone={tokens.accent}>
        <DocIcon size={24} />
      </Glyph>
      <div>
        <p style={{ margin: 0, fontSize: 15, fontWeight: 650, color: tokens.fg }}>No reports indexed yet</p>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: tokens.muted, maxWidth: 420, lineHeight: 1.5 }}>
          The cockpit indexes specs, handoffs, and review reports across the workspace. They appear here on the next derive.
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
