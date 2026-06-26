/**
 * `Source` — the data-connected Source tab. Owns the `git-state` fetch + the
 * cold/error/empty states (the shared three-state frames); everything visual is
 * delegated to the pure `SourceView`. No selection or drawer state (the Source
 * tree is a read-only audit), so this is a thin connector around `useGitState`.
 */

import { useEffect, useState } from "react";
import { SourceIcon } from "../icons.js";
import { SurfaceEmpty, SurfaceError, SurfaceLoading } from "../shared/surface-state.js";
import { clearPendingTarget, usePendingTarget } from "../pending-target-store.js";
import { branchExpandKey } from "./SourceView.js";
import { useGitState } from "../hooks/useGitState.js";
import { useIsMobile } from "../hooks/useMediaQuery.js";
import { useNow } from "../hooks/useNow.js";
import { SourceView } from "./SourceView.js";

export function Source({ companyId }: { companyId: string | null }) {
  const isMobile = useIsMobile();
  const now = useNow();
  const { gitState, loading, error, refresh } = useGitState(companyId);
  const pending = usePendingTarget();

  // Capture the deep-link target ONCE at mount (Source mounts fresh on tab
  // switch, after Home set the pending target), so the matching branch row opens
  // with `defaultExpanded` on its first render; then clear the one-shot store.
  const [expandKey] = useState<string | null>(() =>
    pending && pending.tab === "source" ? branchExpandKey(pending.repoKey, pending.branch) : null,
  );
  useEffect(() => {
    if (pending && pending.tab === "source") clearPendingTarget(pending);
  }, [pending]);

  if (loading && !gitState) return <SurfaceLoading label="Reading the working trees…" />;
  if (error && !gitState) return <SurfaceError message={error.message} onRetry={refresh} />;
  if (!gitState) {
    return (
      <SurfaceEmpty
        icon={<SourceIcon size={24} />}
        title="No source state yet"
        body="The cockpit reads each repo’s branches, worktrees, and recent commits. They appear here on the next derive."
        onRefresh={companyId ? refresh : undefined}
      />
    );
  }

  return <SourceView gitState={gitState} now={now} isMobile={isMobile} expandKey={expandKey} />;
}
