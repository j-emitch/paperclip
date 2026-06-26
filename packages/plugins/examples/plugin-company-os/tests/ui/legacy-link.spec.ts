/**
 * `legacy-link` migration helper (1g.2) + its drift guard. The UI bundle can only
 * import contracts type-only, so `mainCheckoutDocId` re-implements the stable
 * docId tuple locally — this test (NOT part of the UI bundle) imports the real
 * `makeDocId` and pins the two byte-identical, so they can never drift.
 */

import { describe, expect, it } from "vitest";
import { makeDocId } from "../../src/contracts/index.js";
import { mainCheckoutDocId, migrateLegacyReportLink } from "../../src/ui/docs/legacy-link.js";

describe("legacy-link", () => {
  it("mainCheckoutDocId stays byte-identical to the contract makeDocId(_, 'main', _)", () => {
    const cases: ReadonlyArray<[string, string]> = [
      ["company", "docs/superpowers/specs/2026-06-24-COS-1.md"],
      ["juice-bar", "specs/SSF-04.md"],
      ["arc-scraper", "reports/reviews/x.md"],
      ["weird repo", "a/b c/d.md"], // spaces + odd chars — the JSON tuple must still match
    ];
    for (const [repo, relPath] of cases) {
      expect(mainCheckoutDocId(repo, relPath)).toBe(makeDocId(repo, "main", relPath));
    }
  });

  it("migrates a legacy reports deep-link to the equivalent docs deep-link", () => {
    const legacy = { tab: "reports" as const, repo: "company", relPath: "reports/reviews/cos-0.md" };
    const migrated = migrateLegacyReportLink(legacy);
    expect(migrated.tab).toBe("docs");
    expect(migrated.docId).toBe(makeDocId("company", "main", "reports/reviews/cos-0.md"));
  });
});
