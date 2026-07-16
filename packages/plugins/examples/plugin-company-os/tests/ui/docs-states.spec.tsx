/**
 * SSR state-injection for the Docs surface. Renders the PURE `DocsView` (+ the
 * standalone `DocTree`) with `renderToStaticMarkup` (no host bridge, no DOM) and
 * asserts the project → type → doc tree, the provenance badges (incl. the
 * Dogfood-#2 worktree case), the type buckets, and the selection wiring all
 * surface without throwing.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { DocsView } from "../../src/ui/docs/DocsView.js";
import { DocTree } from "../../src/ui/docs/DocTree.js";
import { DocumentViewerPanel } from "../../src/ui/shared/DocumentViewerPanel.js";
import { goldenDocIndex, emptyDocIndex, dogfoodSpecDocId, DOCS_NOW } from "./fixtures/docs.js";

const noop = () => {};
const pre = (md: string): ReactNode => <pre data-testid="md">{md}</pre>;

describe("Docs SSR", () => {
  it("renders the project → type → doc tree from the golden index", () => {
    const html = renderToStaticMarkup(
      <DocsView docIndex={goldenDocIndex()} selectedDocId={null} onSelect={noop} now={DOCS_NOW} viewer={null} />,
    );
    expect(html).toContain("Docs");
    // Project headers
    expect(html).toContain("Company");
    expect(html).toContain("Juice Bar");
    // Type buckets
    expect(html).toContain("Specs");
    expect(html).toContain("Plans");
    expect(html).toContain("Handoffs");
    expect(html).toContain("Reviews");
    expect(html).toContain("Backlog");
    // Doc titles (incl. the dogfood spec) + a basename fallback (backlog has no title)
    expect(html).toContain("COS-1 — Orientation Home");
    expect(html).toContain("SSF-04 reconciliation rehaul");
    expect(html).toContain("2026-06-22-mtp-launch-blocker.md"); // title-less → basename
    // Provenance: the Dogfood-#2 spec carries a worktree badge, not "main"
    expect(html).toContain("worktree: cos-COS-1 @ docs/COS-1");
    expect(html).toContain("main"); // the main-checkout docs
  });

  it("renders the empty index as a calm 0-state, never a crash", () => {
    const html = renderToStaticMarkup(
      <DocTree docIndex={emptyDocIndex()} selectedDocId={null} onSelect={noop} now={DOCS_NOW} />,
    );
    expect(html).toContain("No documents indexed yet");
  });

  it("marks the selected doc as current", () => {
    const selectedId = dogfoodSpecDocId();
    const html = renderToStaticMarkup(
      <DocTree docIndex={goldenDocIndex()} selectedDocId={selectedId} onSelect={noop} now={DOCS_NOW} />,
    );
    expect(html).toContain('aria-current="true"');
  });

  it("the viewer shows the INDEX-derived type label (not the null artifactType) for a plan", () => {
    // A plan's ReportContentV1.artifactType is null; the Docs viewer passes the
    // index type label so the pill still renders.
    const planContent = {
      schemaVersion: 1 as const,
      repo: "company",
      relPath: "docs/superpowers/plans/2026-06-25-COS-1.md",
      status: "ok" as const,
      renderMode: "markdown" as const,
      content: "# COS-1 plan\n\nbody",
      sizeBytes: 42,
      mtime: "2026-06-25T20:00:00Z",
      title: "COS-1 plan",
      docStatus: "approved",
      artifactType: null,
      message: null,
    };
    const html = renderToStaticMarkup(
      <DocumentViewerPanel content={planContent} loading={false} error={null} now={DOCS_NOW} renderMarkdown={pre} typeLabel="Plan" />,
    );
    expect(html).toContain("Plan"); // the index-derived type pill
    expect(html).toContain("approved"); // docStatus
    expect(html).toContain("COS-1 plan");
  });
});

describe("Docs C4 — surface badge + row status/owner badges", () => {
  const noop2 = () => {};

  it("renders the shared SurfaceFreshnessBadge (was a hand-rolled 'as of' clock)", () => {
    const html = renderToStaticMarkup(
      <DocsView docIndex={goldenDocIndex()} selectedDocId={null} onSelect={noop2} now={DOCS_NOW} viewer={null} />,
    );
    expect(html).toContain("Docs is live"); // golden derive is 4min old vs the 5min threshold
  });

  it("renders each doc's frontmatter status as a row pill", () => {
    const html = renderToStaticMarkup(
      <DocTree docIndex={goldenDocIndex()} selectedDocId={null} onSelect={noop2} now={DOCS_NOW} />,
    );
    expect(html).toContain("draft"); // the dogfood spec's status pill
    expect(html).toContain("approved"); // the plan's status pill
  });

  it("renders the owner when frontmatter carries one, and the lastUpdated-first age", () => {
    const idx = goldenDocIndex();
    const first = idx.groups[0].types[0].docs[0];
    const mutated = {
      ...idx,
      groups: idx.groups.map((g, gi) =>
        gi === 0
          ? { ...g, types: g.types.map((b, bi) => (bi === 0 ? { ...b, docs: [{ ...first, owner: "joe", lastUpdated: "2026-06-26" }] } : b)) }
          : g,
      ),
    };
    const html = renderToStaticMarkup(<DocTree docIndex={mutated} selectedDocId={null} onSelect={noop2} now={DOCS_NOW} />);
    expect(html).toContain("joe");
  });
});

describe("Docs C4 — diagnostics strip (codex order-0 fold)", () => {
  it("renders index diagnostics through the shared strip (was invisible)", () => {
    const idx = { ...goldenDocIndex(), diagnostics: [{ level: "info" as const, code: "status_unverified", message: "3 docs carry status: without status_verified_at", repo: "company", source: "doc-index" }] };
    const html = renderToStaticMarkup(
      <DocsView docIndex={idx} selectedDocId={null} onSelect={() => {}} now={DOCS_NOW} viewer={null} />,
    );
    expect(html).toContain("status_unverified");
  });
});
