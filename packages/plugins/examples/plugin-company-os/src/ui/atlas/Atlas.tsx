/**
 * `Atlas` — the data-connected Build Atlas tab. Owns exactly the state the pure
 * view cannot: the live `useBuildAtlas` fetch, a ticking `now`, and the manual
 * refresh action (the shared `refresh-board` derive — one derive recomputes every
 * projection, the Atlas included). Everything visual is delegated to
 * `BuildAtlasView`. Cold cache / worker error / no-atlas each render an explicit,
 * non-crashing panel — the same three-state framing the other cockpit surfaces use.
 */

import { useCallback, useEffect, useState } from "react";
import { usePluginAction } from "@paperclipai/plugin-sdk/ui";
import { useBuildAtlas } from "../hooks/useBuildAtlas.js";
import { useIsMobile } from "../hooks/useMediaQuery.js";
import { useNow } from "../hooks/useNow.js";
import { SurfaceEmpty, SurfaceError, SurfaceLoading } from "../shared/surface-state.js";
import { AtlasIcon } from "../icons.js";
import { BuildAtlasView } from "./BuildAtlasView.js";
import { isAtlasEmpty } from "./atlas-view-model.js";

export function Atlas({ companyId }: { companyId: string | null }) {
  const isMobile = useIsMobile();
  const now = useNow();
  const { buildAtlas, loading, error, refresh } = useBuildAtlas(companyId);

  const refreshAction = usePluginAction("refresh-board");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  // Clear a stale refresh error when the company changes.
  useEffect(() => {
    setRefreshError(null);
  }, [companyId]);

  const handleRefresh = useCallback(() => {
    if (!companyId || refreshing) return;
    setRefreshing(true);
    setRefreshError(null);
    void refreshAction({ companyId })
      .then(() => refresh()) // re-read only after a successful derive
      .catch((err: unknown) => {
        setRefreshError(err instanceof Error ? err.message : "Refresh failed — the worker did not complete a derive.");
      })
      .finally(() => setRefreshing(false));
  }, [companyId, refreshAction, refresh, refreshing]);

  if (loading && !buildAtlas) return <SurfaceLoading label="Loading the Build Atlas…" />;
  if (error && !buildAtlas) return <SurfaceError message={error.message} onRetry={refresh} />;
  if (!buildAtlas || isAtlasEmpty(buildAtlas)) {
    return (
      <SurfaceEmpty
        icon={<AtlasIcon size={24} />}
        title="No atlas yet"
        body="The cockpit hasn’t derived any families yet. The Build Atlas fills in automatically as specs, plans, branches, PRs, and merges land across the workspace."
        onRefresh={companyId ? handleRefresh : undefined}
      />
    );
  }

  return <BuildAtlasView atlas={buildAtlas} now={now} isMobile={isMobile} onRefresh={companyId ? handleRefresh : undefined} refreshing={refreshing} refreshError={refreshError} />;
}
