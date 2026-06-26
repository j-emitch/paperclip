/**
 * Shared `taxonomyFixture()` — the default project taxonomy for Joe's five repos
 * (Company · Juice Bar [+arc-scraper] · Viacava Arts · Paperclip). Used by every
 * test that now must pass a `taxonomy` to `collectAndProject` / the COS-1
 * projections (PF-13). Built via the real `resolveTaxonomy` so it stays in lockstep
 * with the resolver.
 */

import { resolveTaxonomy, type ProjectTaxonomyV1 } from "../../src/contracts/projects.js";

export function taxonomyFixture(): ProjectTaxonomyV1 {
  return resolveTaxonomy([
    "/p/company",
    "/p/juice-bar",
    "/p/arc-scraper",
    "/p/viacava-arts",
    "/p/paperclip",
  ]);
}
