/**
 * `renderTeachingTabSlot` — the ONE SSR render of the Teaching tab's panel slot,
 * shared by (a) the build's flag-off byte-identity snapshot and (b) the
 * `scripts/render-tab-slot.mjs` CLI. Lives OUTSIDE `src/ui/` (like the test
 * harness's `render-doc.tsx`) because it is a build/SSR utility, not a browser
 * module — so it may value-import the contract surface and compose the UI views
 * for server rendering. Taking `enabled` as a PARAM (not reading the flag) keeps
 * it a pure function the caller drives:
 *
 *   - enabled=false → the EXACT COS-0 `PlaceholderPanel` markup. The build snapshots
 *     this and the verify diffs a fresh flag-off render against it: byte-identical
 *     proves the Teaching feature is truly dormant when the flag is off.
 *   - enabled=true  → the pure `TeachingView` over an empty overview (SSR-safe; the
 *     data-connected `Teaching` uses hooks, so the slot stands in with the
 *     empty-corpus shell). Not diffed — a smoke/preview of the enabled slot.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { COMPANY_OS_TABS, type CompanyOsTab } from "./ui/tabs.js";
import { PlaceholderPanel } from "./ui/shared/placeholder-panel.js";
import { TeachingView } from "./ui/teaching/TeachingView.js";
import { EMPTY_TEACHING_FILTER } from "./ui/teaching/teaching-view-model.js";
import { TEACHING_OVERVIEW_SCHEMA_VERSION, type TeachingOverviewV1 } from "./contracts/index.js";

function teachingTab(): CompanyOsTab {
  const tab = COMPANY_OS_TABS.find((t) => t.key === "teaching");
  if (!tab) throw new Error("render-slot: no `teaching` tab in COMPANY_OS_TABS");
  return tab;
}

/** A valid, empty `TeachingOverviewV1` — the enabled slot's SSR stand-in. */
export function emptyTeachingOverview(): TeachingOverviewV1 {
  return {
    schemaVersion: TEACHING_OVERVIEW_SCHEMA_VERSION,
    derivedAt: "1970-01-01T00:00:00.000Z",
    backlog: { pendingLogs: 0, pendingNuggets: 0, oldestPendingAt: null, oldestPendingAgeHours: null },
    synthesis: { lastSynthesisAt: null, ageHours: null, verdict: "never_ran" },
    attention: { level: "ok", reason: null },
    units: [],
    unitCounts: {
      total: 0,
      audience: { internal: 0, external: 0, both: 0 },
      publishState: { private: 0, candidate: 0, ready: 0, published: 0 },
      lens: { internal: 0, external: 0, unspecified: 0 },
    },
    sources: [],
    diagnostics: [],
  };
}

export function renderTeachingTabSlot(enabled: boolean): string {
  if (!enabled) {
    return renderToStaticMarkup(<PlaceholderPanel tab={teachingTab()} />);
  }
  return renderToStaticMarkup(
    <TeachingView overview={emptyTeachingOverview()} filter={EMPTY_TEACHING_FILTER} onFilterChange={() => {}} now={0} />,
  );
}
