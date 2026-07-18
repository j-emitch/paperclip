/**
 * `Skills` — the data-connected Skills tab (COS-1h). Owns the `skills-catalog`
 * fetch, the selection + search state, the connected `skill-content` read for the
 * selected skill, and the shared cold/error/empty frames. Everything visual is
 * delegated to the pure `SkillsView`; the markdown body is the host
 * `<MarkdownBlock>`, injected only here so the view stays bridge-free.
 *
 * The reader mounts only while a skill is selected, so no `skill-content` fetch
 * fires for an empty selection. Selection + search reset when the company changes.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { MarkdownBlock } from "@paperclipai/plugin-sdk/ui";
import type { SkillsCatalogV1 } from "../../contracts/index.js";
import { SkillsIcon } from "../icons.js";
import { SurfaceEmpty, SurfaceError, SurfaceLoading } from "../shared/surface-state.js";
import { useSkillsCatalog } from "../hooks/useSkillsCatalog.js";
import { useSkillContent } from "../hooks/useSkillContent.js";
import { useIsMobile } from "../hooks/useMediaQuery.js";
import { useNow } from "../hooks/useNow.js";
import { DocumentViewerPanel } from "../shared/DocumentViewerPanel.js";
import { SkillsView } from "./SkillsView.js";
import { type SkillSelection } from "./SkillTree.js";
import { filterCatalog, flattenVisible } from "./skills-view-model.js";

/** Production markdown slot — host renderer, wikilinks on, raw HTML inert (react-markdown). */
function renderHostMarkdown(markdown: string) {
  return <MarkdownBlock content={markdown} enableWikiLinks />;
}

export function Skills({ companyId }: { companyId: string | null }) {
  const isMobile = useIsMobile();
  const now = useNow();
  const { catalog, loading, error, refresh } = useSkillsCatalog(companyId);
  const [selected, setSelected] = useState<SkillSelection | null>(null);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // Reset selection + search when the active company changes.
  useEffect(() => {
    setSelected(null);
    setQuery("");
  }, [companyId]);

  const onSelect = useCallback((next: SkillSelection) => setSelected(next), []);
  const onClose = useCallback(() => setSelected(null), []);

  const filtered = useMemo(() => (catalog ? filterCatalog(catalog, query) : null), [catalog, query]);

  // If a search filters the selected skill out of the visible tree, drop the
  // selection so the reader can't show a skill that isn't in the list (codex UI P1).
  useEffect(() => {
    if (selected && filtered && !catalogHasSkill(filtered, selected.entry.skillId)) {
      setSelected(null);
    }
  }, [filtered, selected]);

  // Flattened visible list (render order) + keyboard nav for the surface: "/" focuses
  // the search box; ArrowUp/Down steps the selection through the list and the reader
  // follows. Skips while typing in an input/textarea/reader so it never hijacks text
  // entry or page scroll there.
  const flat = useMemo(() => (filtered ? flattenVisible(filtered) : []), [filtered]);
  const onKeyNav = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (e.key === "/") {
        if (typing) return;
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (typing || (e.key !== "ArrowDown" && e.key !== "ArrowUp") || flat.length === 0) return;
      e.preventDefault();
      const cur = selected ? flat.findIndex((s) => s.skillId === selected.entry.skillId) : -1;
      const next =
        e.key === "ArrowDown"
          ? cur < 0
            ? 0
            : Math.min(cur + 1, flat.length - 1)
          : cur < 0
            ? flat.length - 1
            : Math.max(cur - 1, 0);
      const entry = flat[next];
      if (entry) setSelected({ entry });
    },
    [flat, selected],
  );

  if (loading && !catalog) return <SurfaceLoading label="Loading the skills catalog…" />;
  if (error && !catalog) return <SurfaceError message={error.message} onRetry={refresh} />;
  if (!catalog || !filtered) {
    return (
      <SurfaceEmpty
        icon={<SkillsIcon size={24} />}
        title="No skills indexed yet"
        body="The cockpit indexes your company skills and installed plugin skills. They appear here on the next derive."
        onRefresh={companyId ? refresh : undefined}
      />
    );
  }

  const viewer = selected ? (
    <ConnectedSkillViewer
      key={selected.entry.skillId}
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
      emptyTitle="Pick a skill to read"
      emptyBody="Your company skills and installed plugins render here in full — search the list and choose one."
    />
  );

  return (
    <div onKeyDown={onKeyNav} style={{ minWidth: 0 }}>
      <SkillsView
        catalog={filtered}
        totalUnfiltered={catalog.total}
        selectedSkillId={selected ? selected.entry.skillId : null}
        onSelect={onSelect}
        query={query}
        onQueryChange={setQuery}
        now={now}
        isMobile={isMobile}
        viewer={viewer}
        searchRef={searchRef}
      />
    </div>
  );
}

/** True when any origin/collection in the catalog holds a skill with this id. */
function catalogHasSkill(catalog: SkillsCatalogV1, skillId: string): boolean {
  return catalog.origins.some((o) => o.collections.some((c) => c.skills.some((s) => s.skillId === skillId)));
}

function ConnectedSkillViewer({
  companyId,
  selection,
  now,
  isMobile,
  onClose,
}: {
  companyId: string | null;
  selection: SkillSelection;
  now: number;
  isMobile: boolean;
  onClose?: () => void;
}) {
  const { content, loading, error, refresh } = useSkillContent(companyId, selection.entry.skillId);
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
      typeLabel="Skill"
      loadingLabel="Opening the skill…"
      errorTitle="Couldn’t load the skill"
      backLabel="Back to the skills list"
    />
  );
}
