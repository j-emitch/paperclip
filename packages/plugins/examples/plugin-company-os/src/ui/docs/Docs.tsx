/**
 * `Docs` — the data-connected Docs tab (the COS-1 Reports successor). Owns the
 * `doc-index` fetch, the selection state, the connected `doc-content` read for the
 * selected doc, and the shared cold/error/empty frames. Everything visual
 * is delegated to the pure `DocsView`; the markdown body is the host
 * `<MarkdownBlock>`, injected only here so the view stays bridge-free.
 *
 * COS-8f: this surface is URL-ADDRESSABLE. It consumes two pending deep-link
 * shapes — the legacy `docs` (docId, from Home) and the URL-scheme `doc-copy`
 * (repo/checkout/path[/ck]), resolved EXACT-MATCH against the index via
 * `resolveDocsRoute` (never a raw read). An ambiguous basename renders a
 * disambiguation panel (never auto-picks); an unresolved route renders a miss
 * panel. Every in-app selection writes the canonical params back to the URL
 * (replace) including `ck=`, and the viewer header grows a copy-link button —
 * so the address bar is always shareable and the link survives re-derives.
 *
 * Selection resets when the company changes; the connected viewer mounts only
 * while a doc is selected, so no `doc-content` fetch fires for an empty selection.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MarkdownBlock, useHostLocation, usePluginAction, usePluginToast } from "@paperclipai/plugin-sdk/ui";
import type { DocEntryV1, DocIndexV1 } from "../../contracts/index.js";
import { DocIcon } from "../icons.js";
import { tokens, springTransition } from "../tokens.js";
import { SurfaceEmpty, SurfaceError, SurfaceLoading } from "../shared/surface-state.js";
import { clearPendingTarget, usePendingTarget } from "../pending-target-store.js";
import { useDocIndex } from "../hooks/useDocIndex.js";
import { useDocContent } from "../hooks/useDocContent.js";
import { useIsMobile } from "../hooks/useMediaQuery.js";
import { useNow } from "../hooks/useNow.js";
import { DocumentViewerPanel } from "../shared/DocumentViewerPanel.js";
import {
  checkoutNameOfEntry,
  ckOfEntry,
  docsRouteForEntry,
  parseCockpitSearch,
  printCockpitSearch,
  resolveDocsRoute,
  type DocsRoute,
} from "../routing.js";
import { useWriteRouteToUrl } from "../routing-sync.js";
import { DocsView } from "./DocsView.js";
import { type DocSelection } from "./DocTree.js";
import {
  DOC_TYPE_LABEL_SINGULAR,
  FACET_ALL,
  MISS_RETRY_BACKOFF_MS,
  MISS_RETRY_INITIAL,
  beginMissRefresh,
  checkoutFacetsOf,
  completeMissRefresh,
  docTitle,
  filterDocIndexByCheckout,
  type MissRetryState,
} from "./docs-view-model.js";
import { useDocDiff, useDocFreshness } from "../hooks/useDocGit.js";
import { FreshnessBadge } from "./FreshnessBadge.js";
import { DocDiffPane } from "./DocDiffPane.js";

/** Production markdown slot — host renderer, wikilinks on, raw HTML inert (react-markdown). */
function renderHostMarkdown(markdown: string) {
  return <MarkdownBlock content={markdown} enableWikiLinks />;
}

/** A URL route that reached the index but didn't resolve to exactly one doc. */
type RouteIssue =
  | { kind: "ambiguous"; route: DocsRoute; candidates: DocEntryV1[] }
  | { kind: "miss"; route: DocsRoute };

/** Locate a doc's full selection (entry + bucket type) by docId. */
function findSelection(index: DocIndexV1, docId: string): DocSelection | null {
  for (const group of index.groups) {
    for (const bucket of group.types) {
      const entry = bucket.docs.find((d) => d.docId === docId);
      if (entry) return { entry, type: bucket.type };
    }
  }
  return null;
}

export function Docs({ companyId }: { companyId: string | null }) {
  const isMobile = useIsMobile();
  const now = useNow();
  const { docIndex, loading, error, refresh } = useDocIndex(companyId);
  const pending = usePendingTarget();
  const writeRoute = useWriteRouteToUrl();
  const [selected, setSelected] = useState<DocSelection | null>(null);
  const [routeIssue, setRouteIssue] = useState<RouteIssue | null>(null);
  const [facet, setFacet] = useState<string>(FACET_ALL);

  // Reset the selection when the active company changes.
  useEffect(() => {
    setSelected(null);
    setRouteIssue(null);
    setFacet(FACET_ALL);
  }, [companyId]);

  // History traversal: when Back/Forward walks the URL from a docs route to a
  // non-docs (tab-only) search, the viewer must follow — otherwise the address
  // bar shows `?tab=docs` while a doc stays open and the URL stops being
  // copyable. Only a docs→other TRANSITION clears; the pre-write-back moment
  // of a fresh selection (other→other) never does.
  const location = useHostLocation();
  const prevSearchKindRef = useRef<"docs" | "other">("other");
  useEffect(() => {
    const route = parseCockpitSearch(location.search);
    const kind = route?.kind === "docs" ? "docs" : "other";
    if (prevSearchKindRef.current === "docs" && kind === "other") {
      setSelected(null);
      setRouteIssue(null);
    }
    prevSearchKindRef.current = kind;
  }, [location.search]);

  // A missed route re-resolves whenever the index updates (a scoped refresh
  // may have just indexed it) — resolution success clears the miss panel.
  useEffect(() => {
    if (!docIndex || !routeIssue || routeIssue.kind !== "miss") return;
    const res = resolveDocsRoute(routeIssue.route, docIndex);
    if (res.kind === "resolved") {
      const sel = findSelection(docIndex, res.entry.docId);
      if (sel) {
        setSelected(sel);
        setRouteIssue(null);
      }
    } else if (res.kind === "ambiguous") {
      setRouteIssue({ kind: "ambiguous", route: routeIssue.route, candidates: res.candidates });
    }
  }, [docIndex, routeIssue]);

  // Consume a pending deep-link: legacy `docs` selects by docId; the COS-8f
  // `doc-copy` resolves URL params against the index (exact match / ambiguity
  // panel / miss panel — never a raw read, never an auto-pick).
  useEffect(() => {
    if (!docIndex || !pending) return;
    if (pending.tab === "docs") {
      const sel = findSelection(docIndex, pending.docId);
      if (sel) {
        setSelected(sel);
        setRouteIssue(null);
      }
      clearPendingTarget(pending); // unknown docId — don't leave a stuck target
      return;
    }
    if (pending.tab === "doc-copy") {
      const route: DocsRoute = {
        kind: "docs",
        tab: "docs",
        repoKey: pending.repoKey,
        checkout: pending.checkout,
        relPath: pending.relPath,
        ck: pending.ck,
      };
      const res = resolveDocsRoute(route, docIndex);
      if (res.kind === "resolved") {
        const sel = findSelection(docIndex, res.entry.docId);
        if (sel) {
          setSelected(sel);
          setRouteIssue(null);
          // In-app arrivals (docs-updated chip, Home) land with a tab-only URL —
          // write the resolved copy's canonical params so the address bar is
          // copyable from THIS path too, not just from a list click.
          writeRoute(docsRouteForEntry(res.entry));
        }
      } else if (res.kind === "ambiguous") {
        setRouteIssue({ kind: "ambiguous", route, candidates: res.candidates });
        setSelected(null);
      } else {
        setRouteIssue({ kind: "miss", route });
        setSelected(null);
      }
      clearPendingTarget(pending);
    }
  }, [docIndex, pending, writeRoute]);

  // Every in-app selection writes the CANONICAL params (incl. ck=) back to the
  // URL — replace, so selection churn never spams history (COS-8f T1).
  const onSelect = useCallback(
    (next: DocSelection) => {
      setSelected(next);
      setRouteIssue(null);
      writeRoute(docsRouteForEntry(next.entry));
    },
    [writeRoute],
  );
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

  const viewer = routeIssue ? (
    routeIssue.kind === "ambiguous" ? (
      <DisambiguationPanel
        route={routeIssue.route}
        candidates={routeIssue.candidates}
        onPick={(entry) => {
          const sel = findSelection(docIndex, entry.docId);
          if (sel) onSelect(sel);
        }}
      />
    ) : (
      <ConnectedRouteMissPanel
        // Remount per route identity: the retry machine (stateRef/timerRef) must
        // start FRESH for a different missed URL — an exhausted miss for A must
        // not swallow the auto-refresh cycle for B.
        key={printCockpitSearch(routeIssue.route)}
        route={routeIssue.route}
        companyId={companyId}
        refreshIndex={refresh}
      />
    )
  ) : selected ? (
    <ConnectedDocViewer
      key={selected.entry.docId}
      companyId={companyId}
      selection={selected}
      now={now}
      isMobile={isMobile}
      onClose={isMobile ? onClose : undefined}
    />
  ) : (
    <DocumentViewerPanel
      content={null}
      loading={false}
      error={null}
      now={now}
      isMobile={isMobile}
      renderMarkdown={renderHostMarkdown}
      emptyTitle="Pick a document to read"
      emptyBody="Specs, plans, handoffs, backlog, and reviews render here in place — choose one from the tree."
    />
  );

  const facets = checkoutFacetsOf(docIndex);
  const filteredIndex = filterDocIndexByCheckout(docIndex, facet);

  return (
    <DocsView
      docIndex={filteredIndex}
      selectedDocId={selected ? selected.entry.docId : null}
      onSelect={onSelect}
      now={now}
      isMobile={isMobile}
      viewer={viewer}
      facetBar={facets.length > 2 ? <CheckoutFacetBar facets={facets} active={facet} onPick={setFacet} /> : undefined}
    />
  );
}

/** The COS-8f checkout facet: All · main · one pill per worktree basename. */
function CheckoutFacetBar({ facets, active, onPick }: { facets: string[]; active: string; onPick: (facet: string) => void }) {
  return (
    <div role="group" aria-label="Filter documents by checkout" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {facets.map((value) => {
        const selectedPill = value === active;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={selectedPill}
            onClick={() => onPick(value)}
            style={{
              padding: "4px 10px",
              borderRadius: 999,
              border: `1px solid ${selectedPill ? tokens.accentBorder : tokens.border}`,
              background: selectedPill ? tokens.accentSoft : "transparent",
              color: selectedPill ? tokens.accent : tokens.muted,
              font: "inherit",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              transition: springTransition,
            }}
          >
            {value === FACET_ALL ? "All checkouts" : value}
          </button>
        );
      })}
    </div>
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
  const { freshness, loading: freshnessLoading } = useDocFreshness(companyId, selection.entry.docId);
  const [diffOpen, setDiffOpen] = useState(false);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <DocumentViewerPanel
        content={content}
        loading={loading}
        error={error ? error.message : null}
        now={now}
        isMobile={isMobile}
        renderMarkdown={renderHostMarkdown}
        onRetry={refresh}
        onClose={onClose}
        headerActions={
          <>
            <FreshnessBadge freshness={freshness} loading={freshnessLoading} />
            <DiffToggleButton open={diffOpen} onToggle={() => setDiffOpen((v) => !v)} />
            <CopyLinkButton entry={selection.entry} />
          </>
        }
        typeLabel={DOC_TYPE_LABEL_SINGULAR[selection.type]}
        backLabel="Back to the docs list"
      />
      {diffOpen ? <ConnectedDiffPane companyId={companyId} docId={selection.entry.docId} /> : null}
    </div>
  );
}

/** Mounts (and therefore fetches) ONLY while the diff pane is open. */
function ConnectedDiffPane({ companyId, docId }: { companyId: string | null; docId: string }) {
  const { diff, loading, error } = useDocDiff(companyId, docId);
  return <DocDiffPane diff={diff} loading={loading} error={error ? error.message : null} />;
}

function DiffToggleButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={open}
      aria-label={open ? "Hide the diff vs trunk" : "Show the diff vs trunk"}
      title="Diff vs trunk"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 10px",
        flex: "0 0 auto",
        borderRadius: tokens.radiusSm,
        background: open ? tokens.accentSoft : tokens.secondary,
        border: `1px solid ${open ? tokens.accentBorder : tokens.border}`,
        color: open ? tokens.accent : tokens.muted,
        font: "inherit",
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
        whiteSpace: "nowrap",
        transition: springTransition,
      }}
    >
      {open ? "Hide diff" : "Diff"}
    </button>
  );
}

/**
 * Copy this doc copy's durable cockpit URL (canonical params incl. `ck=`) to
 * the clipboard — the link resolves index-gated, so it survives re-derives.
 */
function CopyLinkButton({ entry }: { entry: DocEntryV1 }) {
  const location = useHostLocation();
  const toast = usePluginToast();
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(() => {
    const search = printCockpitSearch(docsRouteForEntry(entry));
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const url = `${origin}${location.pathname}${search}`;
    void (async () => {
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      } catch {
        toast({ title: "Copy failed", body: url, tone: "error" });
      }
    })();
  }, [entry, location.pathname, toast]);
  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label="Copy a durable link to this document"
      title="Copy link — durable across re-derives"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 10px",
        flex: "0 0 auto",
        borderRadius: tokens.radiusSm,
        background: copied ? tokens.accentSoft : tokens.secondary,
        border: `1px solid ${copied ? tokens.accentBorder : tokens.border}`,
        color: copied ? tokens.accent : tokens.muted,
        font: "inherit",
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
        whiteSpace: "nowrap",
        transition: springTransition,
      }}
    >
      {copied ? "Copied" : "Copy link"}
    </button>
  );
}

/**
 * An ambiguous URL (basename collision, no deciding `ck=`) lists every
 * candidate copy — worktree name, branch, hash — and lets the reader pick.
 * Picking writes the canonical URL WITH `ck=`, so the shared link is fixed.
 */
function DisambiguationPanel({
  route,
  candidates,
  onPick,
}: {
  route: DocsRoute;
  candidates: DocEntryV1[];
  onPick: (entry: DocEntryV1) => void;
}) {
  return (
    <section
      aria-label="Multiple documents match this link"
      style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}
    >
      <div>
        <p style={{ margin: 0, fontSize: 15, fontWeight: 650, color: tokens.fg }}>
          {candidates.length} checkouts match this link
        </p>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: tokens.muted, lineHeight: 1.5 }}>
          <code style={{ fontFamily: tokens.mono, fontSize: 12 }}>{route.relPath}</code> exists in{" "}
          {candidates.length} checkouts named{" "}
          <code style={{ fontFamily: tokens.mono, fontSize: 12 }}>{route.checkout}</code> — pick the copy you
          meant. The picked link includes its checkout hash, so it stays unambiguous.
        </p>
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        {candidates.map((entry) => (
          <li key={entry.docId}>
            <button
              type="button"
              onClick={() => onPick(entry)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                width: "100%",
                textAlign: "left",
                padding: "10px 12px",
                borderRadius: tokens.radiusSm,
                background: tokens.card,
                border: `1px solid ${tokens.border}`,
                color: tokens.fg,
                font: "inherit",
                fontSize: 13,
                cursor: "pointer",
                transition: springTransition,
              }}
            >
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                {docTitle(entry)}
              </span>
              <code style={{ fontFamily: tokens.mono, fontSize: 11, color: tokens.muted }}>
                {checkoutNameOfEntry(entry)}
                {entry.branch ? ` · ${entry.branch}` : ""}
                {ckOfEntry(entry) ? ` · ${ckOfEntry(entry)}` : ""}
              </code>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * A structurally valid URL that resolves to nothing in the index (§4.1 row 3).
 * On mount it fires ONE scoped `refresh-board` for the route's repo, then
 * auto-retries with backoff up to the attempt budget; the pure
 * `beginMissRefresh`/`completeMissRefresh` machine COALESCES dispatches, so
 * repeated clicks (or overlapping timers) never stack refreshes. Contract:
 * NO raw read, NO absolute path shown — only route keys.
 */
function ConnectedRouteMissPanel({
  route,
  companyId,
  refreshIndex,
}: {
  route: DocsRoute;
  companyId: string | null;
  refreshIndex: () => void;
}) {
  const refreshAction = usePluginAction("refresh-board");
  const stateRef = useRef<MissRetryState>(MISS_RETRY_INITIAL);
  const [, force] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dispatchScoped = useCallback(() => {
    if (!companyId) return;
    const { next, dispatch } = beginMissRefresh(stateRef.current);
    stateRef.current = next;
    if (!dispatch) return; // coalesced: in flight or exhausted
    force((n) => n + 1);
    void refreshAction({ companyId, scopeRepo: route.repoKey })
      .catch(() => {})
      .finally(() => {
        // Still missing until the index effect re-resolves us away; schedule
        // the next bounded retry with backoff.
        stateRef.current = completeMissRefresh(stateRef.current, true);
        force((n) => n + 1);
        refreshIndex();
        const backoff = MISS_RETRY_BACKOFF_MS[stateRef.current.attempts - 1];
        if (!stateRef.current.exhausted && backoff !== undefined) {
          timerRef.current = setTimeout(dispatchScoped, backoff);
        }
      });
  }, [companyId, refreshAction, refreshIndex, route.repoKey]);

  useEffect(() => {
    dispatchScoped();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // One auto-cycle per mounted miss route.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dispatchScoped is deliberately excluded: re-creating the callback must not restart the bounded retry cycle; only a route identity change may.
  }, [route.repoKey, route.relPath, route.checkout, route.ck]);

  const st = stateRef.current;
  const body = st.exhausted
    ? `${route.repoKey} · ${route.checkout} · ${route.relPath} is still not indexed after ${st.attempts} refresh attempts — the checkout may be gone, or the doc may live outside the indexed buckets.`
    : st.inFlight
      ? `${route.repoKey} · ${route.checkout} · ${route.relPath} isn’t indexed yet — refreshing the index for ${route.repoKey}…`
      : `${route.repoKey} · ${route.checkout} · ${route.relPath} isn’t indexed right now — the index may be a derive behind.`;

  return (
    <SurfaceEmpty
      icon={<DocIcon size={24} />}
      title={st.exhausted ? "Still not indexed" : "This link isn’t in the index"}
      body={body}
      onRefresh={companyId && !st.exhausted ? dispatchScoped : undefined}
    />
  );
}
