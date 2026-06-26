/**
 * Pure migration of a legacy `{tab:"reports", repo, relPath}` deep-link to the
 * COS-1 `{tab:"docs", docId}` form (1g.2). The `reports→docs` TAB-KEY rename +
 * `active-tab-store` normalization land in 1h (a `docs` `CompanyOsTabKey` only
 * exists after the rename); this helper is the pure piece 1h wires in.
 *
 * The target `docId` is the MAIN-checkout id for the (repo, relPath). It MUST stay
 * byte-identical to the contract `makeDocId(repoKey, "main", relPath)` — but the
 * UI bundle may import contracts TYPE-only (a value import would drag zod into the
 * browser, per the import-boundary), so the stable JSON-tuple encoding is
 * re-implemented here and pinned by a drift-guard test (`legacy-link.spec.ts`,
 * which CAN import the real `makeDocId`).
 */

import type { DeepLink } from "../../contracts/index.js";

export interface LegacyReportDeepLink {
  tab: "reports";
  repo: string;
  relPath: string;
}

/** The main-checkout docId for a (repoKey, relPath) — mirrors contract `makeDocId(_, "main", _)`. */
export function mainCheckoutDocId(repoKey: string, relPath: string): string {
  return JSON.stringify([repoKey, "main", relPath]);
}

/** Migrate a legacy reports deep-link to the equivalent docs deep-link. */
export function migrateLegacyReportLink(legacy: LegacyReportDeepLink): Extract<DeepLink, { tab: "docs" }> {
  return { tab: "docs", docId: mainCheckoutDocId(legacy.repo, legacy.relPath) };
}
