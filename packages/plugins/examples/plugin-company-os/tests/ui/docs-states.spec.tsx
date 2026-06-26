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
import { ReportViewerPanel } from "../../src/ui/reports/ReportViewerPanel.js";
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
      <ReportViewerPanel content={planContent} loading={false} error={null} now={DOCS_NOW} renderMarkdown={pre} typeLabel="Plan" />,
    );
    expect(html).toContain("Plan"); // the index-derived type pill
    expect(html).toContain("approved"); // docStatus
    expect(html).toContain("COS-1 plan");
  });
});
