/**
 * `Docs` — the data-connected Docs tab (the COS-1 Reports successor). Owns the
 * `doc-index` fetch, the selection state, the connected `doc-content` read for the
 * selected doc, and the shared cold/error/empty frames. Consumes a pending deep-
 * link target (a Home "Open in Docs") by selecting that `docId`. Everything visual
 * is delegated to the pure `DocsView`; the markdown body is the host
 * `<MarkdownBlock>`, injected only here so the view stays bridge-free.
 *
 * Selection resets when the company changes; the connected viewer mounts only
 * while a doc is selected, so no `doc-content` fetch fires for an empty selection.
 */

import { useCallback, useEffect, useState } from "react";
import { MarkdownBlock } from "@paperclipai/plugin-sdk/ui";
import { DocIcon } from "../icons.js";
import { SurfaceEmpty, SurfaceError, SurfaceLoading } from "../shared/surface-state.js";
import { clearPendingTarget, usePendingTarget } from "../pending-target-store.js";
import { useDocIndex } from "../hooks/useDocIndex.js";
import { useDocContent } from "../hooks/useDocContent.js";
import { useIsMobile } from "../hooks/useMediaQuery.js";
import { useNow } from "../hooks/useNow.js";
import { ReportViewerPanel } from "../reports/ReportViewerPanel.js";
import { DocsView } from "./DocsView.js";
import { type DocSelection } from "./DocTree.js";
import { DOC_TYPE_LABEL_SINGULAR } from "./docs-view-model.js";

/** Production markdown slot — host renderer, wikilinks on, raw HTML inert (react-markdown). */
function renderHostMarkdown(markdown: string) {
  return <MarkdownBlock content={markdown} enableWikiLinks />;
}

export function Docs({ companyId }: { companyId: string | null }) {
  const isMobile = useIsMobile();
  const now = useNow();
  const { docIndex, loading, error, refresh } = useDocIndex(companyId);
  const pending = usePendingTarget();
  const [selected, setSelected] = useState<DocSelection | null>(null);

  // Reset the selection when the active company changes.
  useEffect(() => {
    setSelected(null);
  }, [companyId]);

  // Consume a pending "Open in Docs" deep-link by selecting that docId.
  useEffect(() => {
    if (!docIndex || !pending || pending.tab !== "docs") return;
    for (const group of docIndex.groups) {
      for (const bucket of group.types) {
        const entry = bucket.docs.find((d) => d.docId === pending.docId);
        if (entry) {
          setSelected({ entry, type: bucket.type });
          clearPendingTarget(pending);
          return;
        }
      }
    }
    clearPendingTarget(pending); // unknown docId — don't leave a stuck target
  }, [docIndex, pending]);

  const onSelect = useCallback((next: DocSelection) => setSelected(next), []);
  const onClose = useCallback(() => setSelected(null), []);

  if (loading && !docIndex) return <SurfaceLoading label="Loading the document index…" />;
  if (error && !docIndex) return <SurfaceError message={error.message} onRetry={refresh} />;
  if (!docIndex) {
    return (
      <SurfaceEmpty
        icon={<DocIcon size={24} />}
        title="No documents indexed yet"
        body="The cockpit indexes specs, plans, handoffs, and reviews across every checkout. They appear here on the next derive."
        onRefresh={companyId ? refresh : undefined}
      />
    );
  }

  const viewer = selected ? (
    <ConnectedDocViewer
      key={selected.entry.docId}
      companyId={companyId}
      selection={selected}
      now={now}
      isMobile={isMobile}
      onClose={isMobile ? onClose : undefined}
    />
  ) : (
    <ReportViewerPanel content={null} loading={false} error={null} now={now} isMobile={isMobile} renderMarkdown={renderHostMarkdown} />
  );

  return (
    <DocsView
      docIndex={docIndex}
      selectedDocId={selected ? selected.entry.docId : null}
      onSelect={onSelect}
      now={now}
      isMobile={isMobile}
      viewer={viewer}
    />
  );
}

function ConnectedDocViewer({
  companyId,
  selection,
  now,
  isMobile,
  onClose,
}: {
  companyId: string | null;
  selection: DocSelection;
  now: number;
  isMobile: boolean;
  onClose?: () => void;
}) {
  const { content, loading, error, refresh } = useDocContent(companyId, selection.entry.docId);
  return (
    <ReportViewerPanel
      content={content}
      loading={loading}
      error={error ? error.message : null}
      now={now}
      isMobile={isMobile}
      renderMarkdown={renderHostMarkdown}
      onRetry={refresh}
      onClose={onClose}
      typeLabel={DOC_TYPE_LABEL_SINGULAR[selection.type]}
    />
  );
}
