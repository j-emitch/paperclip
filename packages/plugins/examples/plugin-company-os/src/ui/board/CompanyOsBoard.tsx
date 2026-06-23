/**
 * `CompanyOsBoard` — the data-connected Kanban. It owns exactly the state the
 * pure view cannot: the live `useBoard` fetch, a ticking `now`, per-lane collapse,
 * and the manual refresh action. Everything visual is delegated to
 * `CompanyOsBoardView`.
 *
 * Collapse model: a lane's collapsed state is its registry default UNLESS the
 * operator has explicitly toggled it (`userCollapsed`). Defaults are recomputed
 * from every new snapshot, so a lane that gains chips auto-expands and one that
 * empties auto-collapses — but a user toggle always wins. The override map resets
 * when the active company changes, so one company's toggles never leak to another.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePluginAction } from "@paperclipai/plugin-sdk/ui";
import { useBoard } from "../hooks/useBoard.js";
import { useIsMobile } from "../hooks/useMediaQuery.js";
import { useNow } from "../hooks/useNow.js";
import { CompanyOsBoardView } from "./CompanyOsBoardView.js";
import { EmptyState, ErrorState, LoadingState } from "./states.js";
import { defaultCollapsedLaneIds, isBoardEmpty } from "./view-model.js";
import type { BoardStateV1 } from "../../contracts/index.js";

export function CompanyOsBoard({ companyId }: { companyId: string | null }) {
  const isMobile = useIsMobile();
  const now = useNow();
  const { board, loading, error, refresh } = useBoard(companyId);

  // Explicit per-lane overrides (laneId → collapsed). Absent ⇒ use the snapshot default.
  const [userCollapsed, setUserCollapsed] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  // Reset overrides when the active company changes — toggles must not leak across companies.
  useEffect(() => {
    setUserCollapsed(new Map());
  }, [companyId]);

  const collapsedLanes = useMemo<ReadonlySet<string>>(() => {
    const set = new Set<string>();
    if (!board) return set;
    const defaults = new Set(defaultCollapsedLaneIds(board));
    for (const id of laneIdsOf(board)) {
      const override = userCollapsed.get(id);
      if (override ?? defaults.has(id)) set.add(id);
    }
    return set;
  }, [board, userCollapsed]);

  const toggleLane = useCallback(
    (laneId: string) => {
      setUserCollapsed((prev) => {
        const defaults = board ? new Set(defaultCollapsedLaneIds(board)) : new Set<string>();
        const current = prev.has(laneId) ? prev.get(laneId)! : defaults.has(laneId);
        const next = new Map(prev);
        next.set(laneId, !current);
        return next;
      });
    },
    [board],
  );

  const setAllCollapsed = useCallback(
    (value: boolean) => {
      if (!board) return;
      setUserCollapsed(new Map(laneIdsOf(board).map((id) => [id, value] as const)));
    },
    [board],
  );

  const refreshAction = usePluginAction("refresh-board");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const handleRefresh = useCallback(() => {
    if (!companyId || refreshing) return;
    setRefreshing(true);
    setRefreshError(null);
    void refreshAction({ companyId })
      .then(() => refresh()) // re-read only after a successful derive
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "Refresh failed — the worker did not complete a derive.";
        setRefreshError(message);
      })
      .finally(() => setRefreshing(false));
  }, [companyId, refreshAction, refresh, refreshing]);

  if (loading && !board) return <LoadingState />;
  if (error && !board) return <ErrorState message={error.message} onRetry={refresh} />;
  if (!board) return <EmptyState onRefresh={companyId ? handleRefresh : undefined} refreshing={refreshing} />;
  if (isBoardEmpty(board)) return <EmptyState onRefresh={companyId ? handleRefresh : undefined} refreshing={refreshing} />;

  return (
    <CompanyOsBoardView
      state={board}
      now={now}
      isMobile={isMobile}
      collapsedLanes={collapsedLanes}
      onToggleLane={toggleLane}
      onSetAllCollapsed={setAllCollapsed}
      onRefresh={companyId ? handleRefresh : undefined}
      refreshing={refreshing}
      refreshError={refreshError}
    />
  );
}

function laneIdsOf(board: BoardStateV1): string[] {
  return board.lanes.map((l) => l.id);
}
