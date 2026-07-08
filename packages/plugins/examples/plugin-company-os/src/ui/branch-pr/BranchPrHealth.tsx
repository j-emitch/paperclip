/**
 * `BranchPrHealth` — the data-connected Branch · PR Health tab (COS-5e; the Source
 * tab elevated). Owns the `git-state` fetch + the cold/error/empty states (the
 * shared three-state frames) and the focus-a-branch interaction; everything visual
 * is delegated to the pure `BranchPrHealthView`.
 *
 * `expandKey` is stateful: it seeds from a consumed Home deep-link (the pending
 * target, whose stable contract tab is still `source`) AND updates when the
 * attention band / review callout asks to focus a branch — the matching `BranchRow`
 * opens + scrolls itself via `defaultExpanded`.
 */

import { useCallback, useEffect, useState } from "react";
import { useHostLocation, usePluginToast } from "@paperclipai/plugin-sdk/ui";
import { BranchPrIcon } from "../icons.js";
import { tokens, springTransition } from "../tokens.js";
import { SurfaceEmpty, SurfaceError, SurfaceLoading } from "../shared/surface-state.js";
import { clearPendingTarget, setPendingTarget, usePendingTarget } from "../pending-target-store.js";
import { branchExpandKey } from "./BranchPrHealthView.js";
import { useGitState } from "../hooks/useGitState.js";
import { useWorktreeBoard } from "../hooks/useWorktreeBoard.js";
import { useIsMobile } from "../hooks/useMediaQuery.js";
import { useNow } from "../hooks/useNow.js";
import { useSelectTab } from "../routing-sync.js";
import { ckOfEntry, printCockpitSearch } from "../routing.js";
import { BranchPrHealthView } from "./BranchPrHealthView.js";
import { WorktreesLens, type WorktreeFocus } from "./WorktreesLens.js";
import type { WorktreeCardV1 } from "../../contracts/worktree-board.js";

type BranchPrLens = "branches" | "worktrees";

export function BranchPrHealth({ companyId }: { companyId: string | null }) {
  const isMobile = useIsMobile();
  const now = useNow();
  const { gitState, loading, error, refresh } = useGitState(companyId);
  const pending = usePendingTarget();
  // COS-8c: the tab is two lenses. A `worktree` deep-link (?tab=branch-pr&wt=…)
  // lands directly on the Worktrees lens AND carries its (repo, wt, ck) through
  // as the lens focus target — the named card highlights + scrolls, or the lens
  // shows a typed miss note (a link to a pruned tree must LOOK broken, not
  // silently land on the generic board).
  const [lens, setLens] = useState<BranchPrLens>(() => (pending?.tab === "worktree" ? "worktrees" : "branches"));
  const [focusWt, setFocusWt] = useState<WorktreeFocus | null>(() =>
    pending?.tab === "worktree" ? { repoKey: pending.repoKey, wt: pending.wt, ck: pending.ck } : null,
  );
  useEffect(() => {
    if (pending?.tab === "worktree") {
      setLens("worktrees");
      setFocusWt({ repoKey: pending.repoKey, wt: pending.wt, ck: pending.ck });
      clearPendingTarget(pending);
    }
  }, [pending]);

  // Seed the focus target from a consumed Home deep-link (the orientation contract's
  // stable `source` tab vocab resolves to this Branch·PR surface). Then the band /
  // callout can retarget it in-view.
  const [expandKey, setExpandKey] = useState<string | null>(() =>
    pending && pending.tab === "source" ? branchExpandKey(pending.repoKey, pending.branch) : null,
  );
  useEffect(() => {
    if (pending && pending.tab === "source") clearPendingTarget(pending);
  }, [pending]);

  const onFocusBranch = useCallback((repoKey: string, branch: string | null) => {
    setExpandKey(branchExpandKey(repoKey, branch));
  }, []);

  if (loading && !gitState) return <SurfaceLoading label="Reading the working trees…" />;
  if (error && !gitState) return <SurfaceError message={error.message} onRetry={refresh} />;
  if (!gitState) {
    return (
      <SurfaceEmpty
        icon={<BranchPrIcon size={24} />}
        title="No branch or PR state yet"
        body="The cockpit reads each repo’s branches, worktrees, open PRs, and review reports. They appear here on the next derive."
        onRefresh={companyId ? refresh : undefined}
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <LensToggle lens={lens} onPick={setLens} />
      {lens === "branches" ? (
        <BranchPrHealthView gitState={gitState} now={now} isMobile={isMobile} expandKey={expandKey} onFocusBranch={onFocusBranch} />
      ) : (
        <ConnectedWorktreesLens companyId={companyId} now={now} isMobile={isMobile} focusWt={focusWt} />
      )}
    </div>
  );
}

/** Mounts (and fetches worktree-board) ONLY while the Worktrees lens is active. */
function ConnectedWorktreesLens({
  companyId,
  now,
  isMobile,
  focusWt,
}: {
  companyId: string | null;
  now: number;
  isMobile: boolean;
  focusWt: WorktreeFocus | null;
}) {
  const { board, loading, error, refresh } = useWorktreeBoard(companyId);
  const selectTab = useSelectTab();
  const location = useHostLocation();
  const toast = usePluginToast();
  // The wt-link PRODUCER (8f symmetry with the Docs copy-link): a card copies
  // its own durable `?tab=branch-pr&repo=…&wt=…[&ck]` URL.
  const onCopyLink = useCallback(
    (card: WorktreeCardV1) => {
      if (!card.worktreeName || !card.checkoutKey) return;
      const search = printCockpitSearch({
        kind: "worktree",
        tab: "branch-pr",
        repoKey: card.repoKey,
        wt: card.worktreeName,
        ck: ckOfEntry({ checkoutKey: card.checkoutKey }),
      });
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const url = `${origin}${location.pathname}${search}`;
      void navigator.clipboard
        .writeText(url)
        .then(() => toast({ title: "Link copied", body: url, tone: "success" }))
        .catch(() => toast({ title: "Copy failed", body: url, tone: "error" }));
    },
    [location.pathname, toast],
  );
  // The docs-updated chip: hand the changed doc to the 8f machinery — pending
  // doc-copy target (repo/checkout/relPath/ck) + tab switch; Docs resolves it
  // index-gated and writes the canonical URL back.
  const onOpenDoc = useCallback(
    (card: WorktreeCardV1, relPath: string) => {
      if (!card.worktreeName || !card.checkoutKey) return;
      setPendingTarget({
        tab: "doc-copy",
        repoKey: card.repoKey,
        checkout: card.worktreeName,
        relPath,
        ck: ckOfEntry({ checkoutKey: card.checkoutKey }),
      });
      selectTab("docs");
    },
    [selectTab],
  );
  if (loading && !board) return <SurfaceLoading label="Reading the worktrees…" />;
  if (error && !board) return <SurfaceError message={error.message} onRetry={refresh} />;
  if (!board) {
    return (
      <SurfaceEmpty
        icon={<BranchPrIcon size={24} />}
        title="No worktree board yet"
        body="The cockpit scans every repo's worktrees — origin, lifecycle lane, and conflict radar. They appear here on the next derive."
        onRefresh={companyId ? refresh : undefined}
      />
    );
  }
  return <WorktreesLens board={board} now={now} isMobile={isMobile} onOpenDoc={onOpenDoc} focusWt={focusWt} onCopyLink={onCopyLink} />;
}

function LensToggle({ lens, onPick }: { lens: BranchPrLens; onPick: (lens: BranchPrLens) => void }) {
  const options: { key: BranchPrLens; label: string }[] = [
    { key: "branches", label: "Branches" },
    { key: "worktrees", label: "Worktrees" },
  ];
  return (
    <div role="group" aria-label="Branch or worktree lens" style={{ display: "inline-flex", gap: 4, alignSelf: "flex-start", padding: 3, background: tokens.secondary, border: `1px solid ${tokens.border}`, borderRadius: 999 }}>
      {options.map((opt) => {
        const selected = opt.key === lens;
        return (
          <button
            key={opt.key}
            type="button"
            aria-pressed={selected}
            onClick={() => onPick(opt.key)}
            style={{
              padding: "5px 14px",
              borderRadius: 999,
              border: "none",
              background: selected ? tokens.accentSoft : "transparent",
              color: selected ? tokens.accent : tokens.muted,
              font: "inherit",
              fontSize: 12.5,
              fontWeight: 600,
              cursor: "pointer",
              transition: springTransition,
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
