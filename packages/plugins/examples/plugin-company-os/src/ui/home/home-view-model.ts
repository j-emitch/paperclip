/**
 * Pure presentation vocabulary for the Home (Orientation) surface — the tone +
 * label maps and the taxonomy grouping helper the six Home panels share. Like
 * every cockpit view-model it owns its OWN label/tone maps (the shared `badges`
 * primitives stay enum-free) and reuses the cross-surface verdict palette from
 * `shared/verdict-labels` so a "fresh" briefing reads the same green as a "fresh"
 * routine SLO. No JSX, no SDK runtime — deterministic + SSR-faithful.
 */

import type { ProjectGroupV1, ProjectTaxonomyV1 } from "../../contracts/projects.js";
import type {
  AlertSeverity,
  HealthSeverity,
  OrientationAlertKind,
  RecentWorkKind,
} from "../../contracts/vocab.js";
import { statusColors, tokens } from "../tokens.js";

// The cross-surface verdict palette lives in `shared/verdict-labels` (keyed off
// the contract vocabulary), so briefing cards read identically to the Agents
// cockpit's routine SLOs WITHOUT either surface coupling to the other (codex B).
export {
  VERDICT_LABELS as BRIEFING_VERDICT_LABELS,
  VERDICT_TONES as BRIEFING_VERDICT_TONES,
  labelForNullableVerdict as labelForNullableBriefingVerdict,
  toneForNullableVerdict as toneForNullableBriefingVerdict,
} from "../shared/verdict-labels.js";
// The branch-health flag labels + severity label/tone maps are shared git/health
// vocabulary (Branch·PR Health tab + Home) — one source of truth in
// `shared/git-labels`. COS-5e moved the severity maps there (a second consumer);
// re-exported so Home panels that import them from here keep working.
export { BRANCH_STATUS_LABELS, HEALTH_SEVERITY_LABELS, HEALTH_SEVERITY_TONES } from "../shared/git-labels.js";
import { HEALTH_SEVERITY_ORDER } from "../shared/git-labels.js";

/** Alert severity → tone. Alerts are only ever high/medium (spec §5.3/§7). */
export const ALERT_SEVERITY_TONES: Record<AlertSeverity, string> = {
  high: statusColors.danger,
  medium: statusColors.stale,
};

export const ALERT_SEVERITY_LABELS: Record<AlertSeverity, string> = {
  high: "High",
  medium: "Medium",
};

export const ALERT_SEVERITY_RANK: Record<AlertSeverity, number> = { high: 0, medium: 1 };

/** The unified "needs attention" alert kinds (spec §5.3). */
export const ALERT_KIND_LABELS: Record<OrientationAlertKind, string> = {
  routine_stale: "Routine stale",
  routine_missing: "Routine missing",
  branch_at_risk: "Branch at risk",
  work_stale: "Work stalled",
};

/** Cross-session work item kinds (spec §5.3). */
export const RECENT_WORK_KIND_LABELS: Record<RecentWorkKind, string> = {
  spec: "Spec",
  plan: "Plan",
  pr: "PR",
  ticket: "Ticket",
};

/** A calm tone per work-kind badge — informational, not alarming. */
export const RECENT_WORK_KIND_TONES: Record<RecentWorkKind, string> = {
  spec: statusColors.proceed,
  plan: statusColors.reviewUnknown,
  pr: statusColors.ship,
  ticket: tokens.muted,
};

/** One project family paired with the items that belong to it (taxonomy order). */
export interface ProjectGrouped<T> {
  group: ProjectGroupV1;
  items: T[];
}

/**
 * Group project-tagged Home items by their `projectKey`, in taxonomy order,
 * returning ONLY the families that actually have items. Home panels are glances
 * (not the full per-project audit Source/Docs render), so a panel shows its
 * non-empty project subsections plus a single panel-level calm 0-state when the
 * whole slice is empty — that honors "show 0 counts" at the panel grain without
 * printing four "all clear" rows per panel. Items whose `projectKey` isn't in the
 * taxonomy (shouldn't happen — the projection resolves keys) are dropped here and
 * counted by the caller's panel total, never silently inflating a group.
 */
export function groupByProject<T extends { projectKey: string }>(
  taxonomy: ProjectTaxonomyV1,
  items: readonly T[],
): ProjectGrouped<T>[] {
  const byKey = new Map<string, T[]>();
  for (const item of items) {
    const bucket = byKey.get(item.projectKey);
    if (bucket) bucket.push(item);
    else byKey.set(item.projectKey, [item]);
  }
  const ordered = [...taxonomy.groups].sort((a, b) => a.order - b.order);
  const result: ProjectGrouped<T>[] = [];
  const claimed = new Set<string>();
  for (const group of ordered) {
    claimed.add(group.key);
    const bucket = byKey.get(group.key);
    if (bucket && bucket.length > 0) result.push({ group, items: bucket });
  }
  // Any item whose projectKey isn't in the taxonomy (shouldn't happen — the
  // projection resolves keys) is collected into a synthetic fallback group so it
  // NEVER silently vanishes while the panel count still includes it (codex A).
  const orphans: T[] = [];
  for (const [key, bucket] of byKey) {
    if (!claimed.has(key)) orphans.push(...bucket);
  }
  if (orphans.length > 0) {
    result.push({
      group: {
        key: "__unknown__",
        displayName: "Unknown project",
        kind: "product",
        repos: [],
        order: Number.MAX_SAFE_INTEGER,
        note: "items whose project could not be resolved from the taxonomy",
      },
      items: orphans,
    });
  }
  return result;
}

/** Sort a copy of branch-health rows worst-severity-first, then most-behind. */
export function sortByHealth<T extends { severity: HealthSeverity; behind: number | null }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    const sev = HEALTH_SEVERITY_ORDER[b.severity] - HEALTH_SEVERITY_ORDER[a.severity]; // worst first
    if (sev !== 0) return sev;
    return (b.behind ?? 0) - (a.behind ?? 0);
  });
}
