/**
 * COS-2f — `TeachingSource` unit tests. Proves the seam fill turns the on-disk
 * teaching corpus into typed `ArtifactSignal`s (+ `TeachingArtifactMeta`) via the
 * in-memory `CollectionContext`, with zero Node/host deps: nugget counting, the
 * pre/post-COS-2b lens split, frontmatter audience/publish defaulting, synthesis
 * receipts (stat-only), README skipping, no-throw degradation, and the crucial
 * byte-identity guard — it is NOT wired into the cached DEFAULT_SOURCES.
 */

import { describe, expect, it } from "vitest";
import { makeFixtureContext, type FixtureFs } from "../fixtures/context.js";
import { teachingSource, TEACHING_SOURCE_ID } from "../../src/sources/TeachingSource.js";
import { DEFAULT_SOURCES } from "../../src/sources/index.js";
import { isArtifactSignal, type ArtifactSignal, type TeachingArtifactMeta } from "../../src/contracts/signals.js";
import type { TeachingSignalSource } from "../../src/contracts/extensions.js";
import type { WorkSignalSource } from "../../src/contracts/WorkSignalSource.js";

const INBOX_OLD = "docs/teachings/inbox/2026-06-28-0745-promote.md";
const INBOX_NEW = "docs/teachings/inbox/2026-07-01-0745-promote.md";
const UNIT_PRE = "docs/teachings/units/03-migrations-and-staging/checksum-drift.md";
const UNIT_INT = "docs/teachings/internal/units/03-migrations-and-staging/single-source-gate.md";
const UNIT_EXT = "docs/teachings/external/units/02-adversarial-review/codex-agentic.md";
const UNIT_README = "docs/teachings/units/03-migrations-and-staging/README.md";
const SYNTH = "reports/routine-runs/2026-07-01/librarian.teachings-synthesis.json";

function corpus(): FixtureFs {
  return {
    company: {
      [INBOX_OLD]: {
        mtime: "2026-06-28T07:45:00.000Z",
        content: "# promote\n- **lesson a** :: why :: alt\n  - _src:_ `u1` @ t\n- **lesson b** :: why :: alt\n",
      },
      [INBOX_NEW]: {
        mtime: "2026-07-01T07:45:00.000Z",
        content: "# promote\n- **lesson c** :: why :: alt\n- **lesson d** :: why\n- **lesson e** :: why\n",
      },
      [UNIT_PRE]: {
        mtime: "2026-06-10T00:00:00.000Z",
        content: "---\ntitle: \"Checksum drift\"\nunit: \"03-migrations-and-staging\"\nlast_verified: 2026-06-10\n---\n\n# Checksum drift\nbody\n",
      },
      [UNIT_INT]: {
        mtime: "2026-07-01T00:00:00.000Z",
        content: "---\ntitle: \"Single-source gate\"\naudience: internal\npublish_state: candidate\n---\n\nbody\n",
      },
      [UNIT_EXT]: {
        mtime: "2026-07-01T00:00:00.000Z",
        content: "---\ntitle: \"Codex agentic invocation\"\naudience: external\npublish_state: published\n---\n\nbody\n",
      },
      [UNIT_README]: { mtime: "2026-06-10T00:00:00.000Z", content: "# Unit 03\nindex\n" },
      [SYNTH]: { mtime: "2026-06-30T03:00:00.000Z", content: "{\"ok\":true}" },
    },
  };
}

function metaByPath(signals: readonly ArtifactSignal[]): Map<string, { sig: ArtifactSignal; meta: TeachingArtifactMeta }> {
  const map = new Map<string, { sig: ArtifactSignal; meta: TeachingArtifactMeta }>();
  for (const s of signals) if (s.teaching) map.set(s.relPath, { sig: s, meta: s.teaching });
  return map;
}

describe("TeachingSource", () => {
  it("emits teaching artifact signals for inbox, units, and synthesis", async () => {
    const batch = await teachingSource.collect(makeFixtureContext({ files: corpus() }));
    const artifacts = batch.signals.filter(isArtifactSignal);
    expect(batch.source).toBe(TEACHING_SOURCE_ID);
    // README is skipped; the other 6 corpus files each yield one signal.
    expect(artifacts).toHaveLength(6);
    expect(artifacts.every((a) => a.artifactType === "teaching")).toBe(true);
    expect(artifacts.every((a) => a.teaching !== undefined)).toBe(true);
    // README produced nothing.
    expect(artifacts.some((a) => a.relPath === UNIT_README)).toBe(false);
  });

  it("counts nuggets per inbox log", async () => {
    const batch = await teachingSource.collect(makeFixtureContext({ files: corpus() }));
    const m = metaByPath(batch.signals.filter(isArtifactSignal));
    expect(m.get(INBOX_OLD)?.meta).toMatchObject({ entryKind: "inbox", pendingNuggets: 2 });
    expect(m.get(INBOX_NEW)?.meta).toMatchObject({ entryKind: "inbox", pendingNuggets: 3 });
  });

  it("derives the lens from the PATH (pre-migration unspecified; internal/external post)", async () => {
    const batch = await teachingSource.collect(makeFixtureContext({ files: corpus() }));
    const m = metaByPath(batch.signals.filter(isArtifactSignal));
    expect(m.get(UNIT_PRE)?.meta.lens).toBe("unspecified");
    expect(m.get(UNIT_INT)?.meta.lens).toBe("internal");
    expect(m.get(UNIT_EXT)?.meta.lens).toBe("external");
  });

  it("reads unit frontmatter and defaults a pre-migration unit to internal/private", async () => {
    const batch = await teachingSource.collect(makeFixtureContext({ files: corpus() }));
    const m = metaByPath(batch.signals.filter(isArtifactSignal));
    // pre-migration unit has no audience/publish_state → defaults, matching COS-2b.
    expect(m.get(UNIT_PRE)?.meta).toMatchObject({ audience: "internal", publishState: "private", unit: "03-migrations-and-staging", lastVerified: "2026-06-10" });
    expect(m.get(UNIT_PRE)?.sig.title).toBe("Checksum drift");
    // explicit frontmatter is honored.
    expect(m.get(UNIT_INT)?.meta).toMatchObject({ audience: "internal", publishState: "candidate" });
    expect(m.get(UNIT_EXT)?.meta).toMatchObject({ audience: "external", publishState: "published" });
  });

  it("emits a stat-only synthesis signal (no read) carrying its mtime", async () => {
    const batch = await teachingSource.collect(makeFixtureContext({ files: corpus() }));
    const m = metaByPath(batch.signals.filter(isArtifactSignal));
    const synth = m.get(SYNTH);
    expect(synth?.meta.entryKind).toBe("synthesis");
    expect(synth?.sig.mtime).toBe("2026-06-30T03:00:00.000Z");
  });

  it("works with NO synthesis dir (never-synthesized corpus)", async () => {
    const files = corpus();
    delete files.company[SYNTH];
    const batch = await teachingSource.collect(makeFixtureContext({ files }));
    const m = metaByPath(batch.signals.filter(isArtifactSignal));
    expect([...m.values()].some((v) => v.meta.entryKind === "synthesis")).toBe(false);
    // and it did not throw / still surfaced the units.
    expect([...m.values()].some((v) => v.meta.entryKind === "unit")).toBe(true);
  });

  it("degrades (does not throw) when a listed file can't be read", async () => {
    const ctx = makeFixtureContext({ files: corpus() });
    // Wrap fs.readText to fail for the pre-migration unit only.
    const realRead = ctx.fs.readText;
    const brokenFs = {
      ...ctx.fs,
      readText: (repo: string, rel: string) =>
        rel === UNIT_PRE ? Promise.reject(new Error("boom: file vanished")) : realRead(repo, rel),
    };
    const batch = await teachingSource.collect({ ...ctx, fs: brokenFs });
    // company's freshness degrades to stale with a recorded error; no throw.
    const company = batch.repoFreshness.find((r) => r.repo === "company");
    expect(company?.freshness).toBe("stale");
    expect(company?.errors.length).toBeGreaterThan(0);
    // the readable signals still came through.
    expect(batch.signals.filter(isArtifactSignal).some((a) => a.relPath === UNIT_INT)).toBe(true);
  });

  it("satisfies the TeachingSignalSource seam and the base WorkSignalSource", () => {
    const asSeam: TeachingSignalSource = teachingSource;
    const asBase: WorkSignalSource = teachingSource;
    expect(asSeam.extensionKind).toBe("teaching");
    expect(asBase.id).toBe(TEACHING_SOURCE_ID);
  });

  it("is NOT in DEFAULT_SOURCES — the cached derive stays byte-identical (COS-2f)", () => {
    expect(DEFAULT_SOURCES.some((s) => s.id === TEACHING_SOURCE_ID)).toBe(false);
  });

  // --- codex-review fold (P1s) -------------------------------------------------
  it("skips an inbox README instead of counting it as a backlog log (codex fold)", async () => {
    const files = corpus();
    files.company["docs/teachings/inbox/README.md"] = { mtime: "2026-07-01T00:00:00.000Z", content: "# inbox index\n" };
    const batch = await teachingSource.collect(makeFixtureContext({ files }));
    expect(metaByPath(batch.signals.filter(isArtifactSignal)).has("docs/teachings/inbox/README.md")).toBe(false);
  });

  it("counts only top-level nuggets — skips nested bullets + fenced blocks (codex fold)", async () => {
    const files = corpus();
    const p = "docs/teachings/inbox/2026-07-02-0745-promote.md";
    files.company[p] = {
      mtime: "2026-07-02T07:45:00.000Z",
      content: "# promote\n- **real one** :: why\n  - **nested is not a nugget**\n```\n- **fenced is not a nugget**\n```\n- **real two** :: why\n",
    };
    const batch = await teachingSource.collect(makeFixtureContext({ files }));
    expect(metaByPath(batch.signals.filter(isArtifactSignal)).get(p)?.meta.pendingNuggets).toBe(2);
  });

  it("falls back to the basename for a blank unit title — never emits '' (codex fold)", async () => {
    const files = corpus();
    const p = "docs/teachings/internal/units/09-verification-discipline/blank.md";
    files.company[p] = { mtime: "2026-07-01T00:00:00.000Z", content: '---\ntitle: ""\naudience: internal\n---\n\nbody\n' };
    const batch = await teachingSource.collect(makeFixtureContext({ files }));
    expect(metaByPath(batch.signals.filter(isArtifactSignal)).get(p)?.sig.title).toBe("blank");
  });

  it("groups a nested unit file under its top unit dir, not Ungrouped (codex fold)", async () => {
    const files = corpus();
    const p = "docs/teachings/internal/units/03-migrations-and-staging/sub/deep.md";
    files.company[p] = { mtime: "2026-07-01T00:00:00.000Z", content: '---\ntitle: "Deep"\n---\n\nbody\n' };
    const batch = await teachingSource.collect(makeFixtureContext({ files }));
    expect(metaByPath(batch.signals.filter(isArtifactSignal)).get(p)?.meta.unit).toBe("03-migrations-and-staging");
  });
});
