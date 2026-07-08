/**
 * The cockpit's tab taxonomy — single source of truth consumed by both the page
 * tab bar and the route sidebar so they cannot drift. The array order IS the
 * display order: the live daily-driver surfaces first, in workflow order
 * (Home -> Atlas -> Branch·PR -> Docs -> Agents -> Skills), then the placeholders
 * in arrival order (Teaching = COS-2, Knowledge = COS-3, Hygiene = COS-4).
 * Adding a surface or lighting one up is a one-line change here.
 */
export type CompanyOsTabKey =
  | "home"
  | "atlas"
  | "branch-pr"
  | "docs"
  | "agents"
  | "skills"
  | "teaching"
  | "knowledge"
  | "hygiene";

export interface CompanyOsTab {
  key: CompanyOsTabKey;
  label: string;
  description: string;
  /** The phase that lights this tab up with live data. */
  liveIn: string;
  /** Placeholder tabs reserved for a later COS phase. */
  placeholder?: boolean;
}

export const COMPANY_OS_TABS: readonly CompanyOsTab[] = [
  {
    key: "home",
    label: "Home",
    description: "Your daily driver — briefing, branch health, and what needs attention, at a glance.",
    liveIn: "COS-1e",
  },
  {
    key: "atlas",
    label: "Atlas",
    description: "The Build Atlas — every spec-prefix family with a Spec·Plan·Build·Prod lifecycle, built bar, and lineage across the workspace.",
    liveIn: "COS-5d",
  },
  {
    key: "branch-pr",
    label: "Branches · Worktrees",
    description: "Every branch + worktree vs trunk — ahead/behind, dirty, stale, conflicts — with each open PR's lifecycle + review verdict, and what needs attention.",
    liveIn: "COS-5e",
  },
  {
    key: "docs",
    label: "Docs",
    description: "Specs, plans, handoffs, backlog, and review reports — from every branch and worktree, rendered in place.",
    liveIn: "COS-1g",
  },
  {
    key: "agents",
    label: "Agents",
    description:
      "CEO / COO / CTO / Librarian as an org constellation — identity, duties, routine SLO health, overlaps, and hand-offs.",
    liveIn: "COS-1R-e",
  },
  {
    key: "skills",
    label: "Skills",
    description: "Your Claude/Codex skills — company skills plus installed plugins, summarized and readable in place.",
    liveIn: "COS-1h",
  },
  {
    key: "teaching",
    label: "Teaching",
    description: "The teaching loop — inbox backlog, synthesis health, and the internal/external curriculum.",
    liveIn: "COS-2",
    placeholder: true,
  },
  {
    key: "knowledge",
    label: "Knowledge",
    description: "Library / classifier / graph convergence. Arrives in COS-3.",
    liveIn: "COS-3",
    placeholder: true,
  },
  {
    key: "hygiene",
    label: "Hygiene",
    description: "Paperclip write-authority audit — what the agents archived, reconciled, and closed (PWA-01). Arrives in COS-4.",
    liveIn: "COS-4",
    placeholder: true,
  },
] as const;

/** Home is the daily-driver landing (COS-1h IA reorg). */
export const DEFAULT_TAB_KEY: CompanyOsTabKey = "home";

export function isCompanyOsTabKey(value: string): value is CompanyOsTabKey {
  return COMPANY_OS_TABS.some((tab) => tab.key === value);
}

/**
 * Tab keys that were renamed, mapped to their current key. `reports` became
 * `docs` when the Docs surface superseded the Reports tab (COS-1g/1h); `routines`
 * became `agents` when the Agents cockpit subsumed the standalone routine board
 * (COS-1R); `board` became `atlas` when the Build Atlas replaced the Kanban
 * (COS-5d); `source` became `branch-pr` when the Source tab grew into the dedicated
 * Branch · PR Health section (COS-5e). Single source of the legacy tab-key map,
 * consumed by the active-tab store to resolve a persisted pre-rename key forward
 * instead of onto a dead tab.
 */
const LEGACY_TAB_KEYS: Readonly<Record<string, CompanyOsTabKey>> = {
  reports: "docs",
  routines: "agents",
  board: "atlas",
  source: "branch-pr",
};

/**
 * Resolve an arbitrary string to a live tab key: a current key maps to itself, a
 * known legacy key (e.g. `reports`) maps forward, and anything unrecognized
 * falls back to the default landing tab. Used by the active-tab store to
 * sanitize a persisted key across the `reports` -> `docs`, `routines` ->
 * `agents`, `board` -> `atlas`, and `source` -> `branch-pr` renames so a returning
 * session never lands on a dead tab.
 */
export function normalizeTabKey(value: string): CompanyOsTabKey {
  return resolveTabKey(value) ?? DEFAULT_TAB_KEY;
}

/**
 * Strict variant for URL routing (COS-8f): a current key maps to itself, a known
 * legacy key maps forward, and anything unrecognized returns `null` — a shared
 * URL with a bogus `tab=` must surface as a MISS, never silently land on the
 * default tab (that would make a broken link look like a working one).
 */
export function resolveTabKey(value: string): CompanyOsTabKey | null {
  if (isCompanyOsTabKey(value)) return value;
  return LEGACY_TAB_KEYS[value] ?? null;
}
