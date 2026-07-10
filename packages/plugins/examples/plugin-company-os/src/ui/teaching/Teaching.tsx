/**
 * `Teaching` — the data-connected Teaching tab (COS-2f). Owns the live
 * `teaching-overview` fetch + the filter state, and delegates all rendering to the
 * pure `TeachingView`. Cold cache / worker error / no-data each render the SHARED
 * surface-state panels (B5 — the same three-state framing every other cockpit
 * surface uses; the bespoke frames with their hardcoded danger literal are gone).
 * Filter resets when the active company changes.
 */

import { useEffect, useState } from "react";
import { SurfaceEmpty, SurfaceError, SurfaceLoading } from "../shared/surface-state.js";
import { TeachingIcon } from "../icons.js";
import { useTeaching } from "../hooks/useTeaching.js";
import { useIsMobile } from "../hooks/useMediaQuery.js";
import { useNow } from "../hooks/useNow.js";
import { TeachingView } from "./TeachingView.js";
import { EMPTY_TEACHING_FILTER, type TeachingFilter } from "./teaching-view-model.js";

export function Teaching({ companyId }: { companyId: string | null }) {
  const isMobile = useIsMobile();
  const now = useNow();
  const { overview, loading, error, refresh } = useTeaching(companyId);
  const [filter, setFilter] = useState<TeachingFilter>(() => ({ ...EMPTY_TEACHING_FILTER }));

  // Reset the filter when the active company changes.
  useEffect(() => {
    setFilter({ ...EMPTY_TEACHING_FILTER });
  }, [companyId]);

  if (loading && !overview) return <SurfaceLoading label="Reading the teaching corpus…" />;
  if (error && !overview) return <SurfaceError message={error.message} onRetry={refresh} />;
  if (!overview) {
    return (
      <SurfaceEmpty
        icon={<TeachingIcon size={24} />}
        title="No teaching data yet"
        body="The cockpit reads the teaching inbox, synthesis receipts, and units on the next derive."
        onRefresh={companyId ? refresh : undefined}
      />
    );
  }

  return <TeachingView overview={overview} filter={filter} onFilterChange={setFilter} now={now} isMobile={isMobile} />;
}
