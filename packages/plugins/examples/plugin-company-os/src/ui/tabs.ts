/**
 * The cockpit's tab taxonomy — single source of truth consumed by both the
 * page tab bar and the route sidebar so they cannot drift. Adding the COS-1
 * Teaching / COS-2 Knowledge surfaces is a one-line change here.
 */
// `home` + `source` are pre-wired in 1d.8 (union member + icon + app branch) but
// NOT added to the visible COMPANY_OS_TABS array until their views land (1e/1f),
// so the rail never renders a half-wired clickable tab. `docs` is NOT added here —
// it's the `reports`→`docs` rename in 1h (adding it before then is an excess-property
// error against the exhaustive TAB_ICONS Record).
export type CompanyOsTabKey = "home" | "source" | "board" | "reports" | "routines" | "hygiene" | "teaching" | "knowledge";

export interface CompanyOsTab {
  key: CompanyOsTabKey;
  label: string;
  description: string;
  /** The phase that lights this tab up with live data. */
  liveIn: string;
  /** Placeholder tabs reserved for COS-1 / COS-2. */
  placeholder?: boolean;
}

export const COMPANY_OS_TABS: readonly CompanyOsTab[] = [
  {
    key: "board",
    label: "Board",
    description: "Auto-updating Kanban across systems x spec-prefix families. Chips move themselves.",
    liveIn: "COS-0e",
  },
  {
    key: "reports",
    label: "Reports",
    description: "Specs, handoffs, and review reports — rendered in place.",
    liveIn: "COS-0f",
  },
  {
    key: "routines",
    label: "Routines",
    description: "CEO / COO / CTO / Librarian routine outputs plus their SLO health.",
    liveIn: "COS-0f",
  },
  {
    key: "hygiene",
    label: "Hygiene",
    description: "Paperclip write-authority audit — what the agents archived, reconciled, and closed (PWA-01). Arrives in COS-3.",
    liveIn: "COS-3",
    placeholder: true,
  },
  {
    key: "teaching",
    label: "Teaching",
    description: "The teaching loop surface — arrives in COS-1.",
    liveIn: "COS-1",
    placeholder: true,
  },
  {
    key: "knowledge",
    label: "Knowledge",
    description: "Library / classifier / graph convergence — arrives in COS-2.",
    liveIn: "COS-2",
    placeholder: true,
  },
] as const;

export const DEFAULT_TAB_KEY: CompanyOsTabKey = "board";

export function isCompanyOsTabKey(value: string): value is CompanyOsTabKey {
  return COMPANY_OS_TABS.some((tab) => tab.key === value);
}
