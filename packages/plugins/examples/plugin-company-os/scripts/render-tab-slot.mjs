#!/usr/bin/env node
/**
 * COS-2f — render the Teaching tab's panel slot to stdout, flag-aware. Used by the
 * build's flag-off byte-identity verify:
 *
 *   diff <(COS_TEACHING_TAB_ENABLED= node scripts/render-tab-slot.mjs) \
 *        dist/.teaching-flagoff-snapshot
 *
 * With the flag off this prints the exact COS-0 placeholder — so a byte-identical
 * diff against the build-emitted snapshot proves the Teaching feature is dormant
 * when off. Loads the standalone CJS renderer the build produced
 * (`dist/render-slot.cjs`) via createRequire, so it runs under plain `node` (no TS
 * transform, no ESM/CJS interop surprises); run `npm run build` first.
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { renderTeachingTabSlot } = require("../dist/render-slot.cjs");

// Matches src/ui/flags.ts isFlagOn: only the literal on-tokens count (else off).
const raw = process.env.COS_TEACHING_TAB_ENABLED ?? "";
const enabled = raw === "1" || raw === "true";

process.stdout.write(renderTeachingTabSlot(enabled));
