/**
 * `CompanyOsBoard` — the data-connected Kanban. It owns exactly the state the
 * pure view cannot: the live `useBoard` fetch, per-lane collapse, and the manual
 * refresh action. Everything visual is delegated to `CompanyOsBoardView`. The
 * loading / error / empty / cold states are explicit so the board never crashes
 * on a missing or malformed snapshot.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { usePluginAction } from "@paperclipai/plugin-sdk/ui";
import { useBoard } from "../hooks/useBoard.js";
import { useIsMobile } from "../hooks/useMediaQuery.js";
import { CompanyOsBoardView } from "./CompanyOsBoardView.js";
import { EmptyState, ErrorState, LoadingState } from "./states.js";
import { defaultCollapsedLaneIds, isBoardEmpty } from "./view-model.js";
import type { BoardStateV1 } from "../../contracts/index.js";

export function CompanyOsBoard({ companyId }: { companyId: string | null }) {
  const isMobile = useIsMobile();
  const { board, loading, error, refresh } = useBoard(companyId);

  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const seenLanes = useRef<Set<string>>(new Set());

  // Seed default-collapsed lanes the first time each lane id appears; never
  // re-seed a lane the operator has since toggled (first-seen-only).
  useEffect(() => {
    if (!board) return;
    const defaults = new Set(defaultCollapsedLaneIds(board));
    const laneIds = laneIdsOf(board);
    const unseen = laneIds.filter((id) => !seenLanes.current.has(id));
    if (unseen.length === 0) return;
    setCollapsed((prev) => {
      const next = new Set(prev);
      for (const id of unseen) {
        if (defaults.has(id)) next.add(id);
        seenLanes.current.add(id);
      }
      return next;
    });
  }, [board]);

  const toggleLane = useCallback((laneId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(laneId)) next.delete(laneId);
      else next.add(laneId);
      return next;
    });
  }, []);

  const setAllCollapsed = useCallback(
    (value: boolean) => {
      if (!board) return;
      setCollapsed(value ? new Set(laneIdsOf(board)) : new Set());
    },
    [board],
  );

  const refreshAction = usePluginAction("refresh-board");
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = useCallback(() => {
    if (!companyId || refreshing) return;
    setRefreshing(true);
    void refreshAction({ companyId })
      .catch(() => {
        /* surfaced on the next read; the board stays put */
      })
      .finally(() => {
        setRefreshing(false);
        refresh();
      });
  }, [companyId, refreshAction, refresh, refreshing]);

  if (loading && !board) return <LoadingState />;
  if (error && !board) return <ErrorState message={error.message} onRetry={refresh} />;
  if (!board) return <EmptyState onRefresh={companyId ? handleRefresh : undefined} />;
  if (isBoardEmpty(board)) return <EmptyState onRefresh={companyId ? handleRefresh : undefined} />;

  return (
    <CompanyOsBoardView
      state={board}
      now={Date.now()}
      isMobile={isMobile}
      collapsedLanes={collapsed}
      onToggleLane={toggleLane}
      onSetAllCollapsed={setAllCollapsed}
      onRefresh={companyId ? handleRefresh : undefined}
      refreshing={refreshing}
    />
  );
}

function laneIdsOf(board: BoardStateV1): string[] {
  return board.lanes.map((l) => l.id);
}
