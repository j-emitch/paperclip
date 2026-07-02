/**
 * `Teaching` — the data-connected Teaching tab (COS-2f). Owns the live
 * `teaching-overview` fetch + the filter state, and delegates all rendering to the
 * pure `TeachingView`. Cold cache / worker error / (handled downstream) empty
 * corpus each render an explicit, non-crashing panel. Filter resets when the
 * active company changes.
 */

import { useEffect, useState } from "react";
import { tokens } from "../tokens.js";
import { Frame, Glyph, LocalSpinner, ghostButtonStyle } from "../shared/feedback.js";
import { AlertIcon, RefreshIcon, TeachingIcon } from "../icons.js";
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

  if (loading && !overview) {
    return (
      <Frame>
        <LocalSpinner />
        <p style={{ margin: 0, fontSize: 14, color: tokens.muted }} aria-live="polite">
          Reading the teaching corpus…
        </p>
      </Frame>
    );
  }

  if (error && !overview) {
    return (
      <Frame>
        <Glyph tone="oklch(0.64 0.21 25)">
          <AlertIcon size={24} />
        </Glyph>
        <div>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 650, color: tokens.fg }}>Couldn’t reach the worker</p>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: tokens.muted, maxWidth: 380 }}>{error.message}</p>
        </div>
        <button type="button" onClick={refresh} style={ghostButtonStyle}>
          <span aria-hidden="true" style={{ display: "inline-flex" }}>
            <RefreshIcon size={14} />
          </span>
          Try again
        </button>
      </Frame>
    );
  }

  if (!overview) {
    return (
      <Frame>
        <Glyph tone={tokens.accent}>
          <TeachingIcon size={24} />
        </Glyph>
        <div>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 650, color: tokens.fg }}>No teaching data yet</p>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: tokens.muted, maxWidth: 420, lineHeight: 1.5 }}>
            The cockpit reads the teaching inbox, synthesis receipts, and units on the next derive.
          </p>
        </div>
        {companyId ? (
          <button type="button" onClick={refresh} style={ghostButtonStyle}>
            <span aria-hidden="true" style={{ display: "inline-flex" }}>
              <RefreshIcon size={14} />
            </span>
            Refresh
          </button>
        ) : null}
      </Frame>
    );
  }

  return <TeachingView overview={overview} filter={filter} onFilterChange={setFilter} now={now} isMobile={isMobile} />;
}
