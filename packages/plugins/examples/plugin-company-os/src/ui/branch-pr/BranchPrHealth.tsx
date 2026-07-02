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
import { BranchPrIcon } from "../icons.js";
import { SurfaceEmpty, SurfaceError, SurfaceLoading } from "../shared/surface-state.js";
import { clearPendingTarget, usePendingTarget } from "../pending-target-store.js";
import { branchExpandKey } from "./BranchPrHealthView.js";
import { useGitState } from "../hooks/useGitState.js";
import { useIsMobile } from "../hooks/useMediaQuery.js";
import { useNow } from "../hooks/useNow.js";
import { BranchPrHealthView } from "./BranchPrHealthView.js";

export function BranchPrHealth({ companyId }: { companyId: string | null }) {
  const isMobile = useIsMobile();
  const now = useNow();
  const { gitState, loading, error, refresh } = useGitState(companyId);
  const pending = usePendingTarget();

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
    <BranchPrHealthView gitState={gitState} now={now} isMobile={isMobile} expandKey={expandKey} onFocusBranch={onFocusBranch} />
  );
}
