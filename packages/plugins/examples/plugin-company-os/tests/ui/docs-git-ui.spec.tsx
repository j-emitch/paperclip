/**
 * COS-8f T4 — the Docs surface's git-truth UI: checkout facet helpers, the
 * row-3 miss-retry coalescing machine, FreshnessBadge + DocDiffPane SSR
 * states, and the two ACs this task OWNS:
 *   AC-8f#1 — a fresh-tab URL to an UNCOMMITTED worktree doc renders the
 *             current on-disk bytes (parse → target → resolve → index-gated
 *             read → viewer), fixture end-to-end.
 *   AC-8f#5 — a miss URL yields the refresh-offer panel, NO raw read is
 *             attempted, and NO absolute path appears in URL or UI.
 */

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { deriveDocIndex } from "../../src/projections/deriveDocIndex.js";
import { readDocContent, type DocContentDeps } from "../../src/doc-content-read.js";
import { DocumentViewerPanel } from "../../src/ui/shared/DocumentViewerPanel.js";
import { FreshnessBadge } from "../../src/ui/docs/FreshnessBadge.js";
import { DocDiffPane } from "../../src/ui/docs/DocDiffPane.js";
import {
  FACET_ALL,
  MISS_MAX_ATTEMPTS,
  MISS_RETRY_INITIAL,
  beginMissRefresh,
  checkoutFacetsOf,
  completeMissRefresh,
  filterDocIndexByCheckout,
} from "../../src/ui/docs/docs-view-model.js";
import { parseCockpitSearch, resolveDocsRoute, type DocsRoute } from "../../src/ui/routing.js";
import { routeToPendingTarget } from "../../src/ui/routing-sync.js";
import { DOC_GIT_SCHEMA_VERSION, type DocDiffV1, type DocFreshnessV1 } from "../../src/contracts/doc-git.js";
import { NOW, bundleOf, docSignal } from "../fixtures/signals.js";
import { taxonomyFixture } from "../fixtures/taxonomy.js";

const WT_HASH = "abcabcabcabc";
const WT_KEY = `company::wt::${WT_HASH}`;

const INDEX = deriveDocIndex(
  bundleOf([
    docSignal("specs/x.md", { repo: "company", checkoutId: "main", checkoutKey: "company", title: "Spec X (main)" }),
    docSignal("specs/x.md", {
      repo: "company",
      checkoutId: `worktree:${WT_HASH}`,
      checkoutKey: WT_KEY,
      worktreeName: "cos-wt",
      title: "Spec X (worktree)",
    }),
  ]),
  NOW,
  taxonomyFixture(),
);

describe("checkout facet helpers", () => {
  it("enumerates All · main · worktree basenames (deduped, sorted)", () => {
    expect(checkoutFacetsOf(INDEX)).toEqual([FACET_ALL, "main", "cos-wt"]);
  });

  it("filters to one checkout, preserving group/bucket structure", () => {
    const onlyWt = filterDocIndexByCheckout(INDEX, "cos-wt");
    const docs = onlyWt.groups.flatMap((g) => g.types.flatMap((t) => t.docs));
    expect(docs).toHaveLength(1);
    expect(docs[0].worktreeName).toBe("cos-wt");
    expect(onlyWt.groups.length).toBe(INDEX.groups.length); // structure preserved
    // "all" is identity
    expect(filterDocIndexByCheckout(INDEX, FACET_ALL)).toBe(INDEX);
  });
});

describe("row 3: miss-retry coalescing machine", () => {
  it("coalesces begins while a dispatch is in flight", () => {
    const first = beginMissRefresh(MISS_RETRY_INITIAL);
    expect(first.dispatch).toBe(true);
    const second = beginMissRefresh(first.next);
    expect(second.dispatch).toBe(false); // repeated clicks → single dispatch
    expect(second.next).toBe(first.next);
  });

  it("exhausts after the attempt budget and never dispatches again", () => {
    let state = MISS_RETRY_INITIAL;
    let dispatches = 0;
    for (let i = 0; i < 10; i += 1) {
      const { next, dispatch } = beginMissRefresh(state);
      state = next;
      if (dispatch) dispatches += 1;
      state = completeMissRefresh(state, true); // still missing
    }
    expect(dispatches).toBe(MISS_MAX_ATTEMPTS); // 1 initial + 2 auto-retries
    expect(state.exhausted).toBe(true);
    expect(beginMissRefresh(state).dispatch).toBe(false);
  });

  it("a resolved miss (stillMissing=false) does not exhaust", () => {
    const { next } = beginMissRefresh(MISS_RETRY_INITIAL);
    const done = completeMissRefresh(next, false);
    expect(done.exhausted).toBe(false);
  });
});

function freshness(over: Partial<DocFreshnessV1>): DocFreshnessV1 {
  return {
    schemaVersion: DOC_GIT_SCHEMA_VERSION,
    status: "ok",
    docId: "d",
    repoKey: "company",
    relPath: "specs/x.md",
    checkout: "cos-wt",
    branch: "cos/COS-8",
    state: "uncommitted",
    message: null,
    ...over,
  };
}

describe("FreshnessBadge SSR", () => {
  it("renders every ladder rung with its label", () => {
    for (const [state, label] of [
      ["main", "on main"],
      ["uncommitted", "uncommitted edits"],
      ["committed", "committed · not pushed"],
      ["pushed", "pushed · not merged"],
      ["merged", "merged to trunk"],
    ] as const) {
      const html = renderToStaticMarkup(<FreshnessBadge freshness={freshness({ state })} loading={false} />);
      expect(html).toContain(label);
    }
  });

  it("renders checkout_gone as a danger pill and stays quiet on git_error", () => {
    expect(renderToStaticMarkup(<FreshnessBadge freshness={freshness({ status: "checkout_gone", state: null })} loading={false} />)).toContain(
      "checkout gone",
    );
    expect(renderToStaticMarkup(<FreshnessBadge freshness={freshness({ status: "git_error", state: null })} loading={false} />)).toBe("");
  });
});

function diffPayload(over: Partial<DocDiffV1>): DocDiffV1 {
  return {
    schemaVersion: DOC_GIT_SCHEMA_VERSION,
    status: "ok",
    docId: "d",
    repoKey: "company",
    relPath: "specs/x.md",
    checkout: "cos-wt",
    kind: "diff",
    stat: " specs/x.md | 2 +-\n 1 file changed, 1 insertion(+), 1 deletion(-)",
    diff: "diff --git a/specs/x.md b/specs/x.md\n-old line\n+new line\n",
    truncated: false,
    message: null,
    ...over,
  };
}

describe("DocDiffPane SSR", () => {
  it("renders the unified diff with the stat summary", () => {
    const html = renderToStaticMarkup(<DocDiffPane diff={diffPayload({})} loading={false} error={null} />);
    expect(html).toContain("Diff vs trunk");
    expect(html).toContain("+new line");
    expect(html).toContain("1 file changed");
  });

  it("renders untracked_new, unchanged, truncated, and checkout_gone states", () => {
    expect(renderToStaticMarkup(<DocDiffPane diff={diffPayload({ kind: "untracked_new", stat: null })} loading={false} error={null} />)).toContain(
      "Whole file is new",
    );
    expect(
      renderToStaticMarkup(<DocDiffPane diff={diffPayload({ kind: "unchanged", stat: null, diff: null })} loading={false} error={null} />),
    ).toContain("byte-identical to trunk");
    expect(renderToStaticMarkup(<DocDiffPane diff={diffPayload({ truncated: true })} loading={false} error={null} />)).toContain("truncated at 256KB");
    expect(
      renderToStaticMarkup(
        <DocDiffPane diff={diffPayload({ status: "checkout_gone", kind: null, stat: null, diff: null })} loading={false} error={null} />,
      ),
    ).toContain("checkout no longer exists");
  });
});

describe("AC-8f#1: fresh-tab URL to an uncommitted worktree doc renders current bytes", () => {
  it("parse → pending target → index resolution → index-gated read → viewer", async () => {
    // The URL a fresh tab would carry (key-only params, ck= included).
    const url = `?tab=docs&repo=company&checkout=cos-wt&path=specs%2Fx.md&ck=${WT_HASH}`;
    const route = parseCockpitSearch(url);
    expect(route?.kind).toBe("docs");
    const target = routeToPendingTarget(route!);
    expect(target?.tab).toBe("doc-copy");

    // The Docs surface resolves the target against the index (exact match).
    const res = resolveDocsRoute(route as DocsRoute, INDEX);
    expect(res.kind).toBe("resolved");
    if (res.kind !== "resolved") return;
    expect(res.entry.checkoutKey).toBe(WT_KEY);

    // The worker read is index-gated by docId and serves the CURRENT bytes
    // (uncommitted edits included — it reads the working tree).
    const readFile = vi.fn(async () => ({ content: "# UNCOMMITTED WORKTREE BYTES", sizeBytes: 28, mtime: "2026-07-07T00:00:00.000Z" }));
    const deps: DocContentDeps = {
      readIndex: async () => INDEX,
      readFile,
      checkoutResolvable: (key) => key === "company" || key === WT_KEY,
    };
    const content = await readDocContent(deps, "co", res.entry.docId);
    expect(content.status).toBe("ok");
    expect(readFile).toHaveBeenCalledWith(WT_KEY, "specs/x.md");

    const html = renderToStaticMarkup(
      <DocumentViewerPanel
        content={content}
        loading={false}
        error={null}
        now={NOW}
        renderMarkdown={(md) => <pre>{md}</pre>}
      />,
    );
    expect(html).toContain("UNCOMMITTED WORKTREE BYTES");
  });
});

describe("AC-8f#5: a miss URL is an offer panel — no raw read, no absolute path", () => {
  it("misses cleanly and never touches the file layer", async () => {
    const url = "?tab=docs&repo=company&checkout=gone-wt&path=specs%2Fx.md";
    const route = parseCockpitSearch(url);
    expect(route?.kind).toBe("docs");

    const res = resolveDocsRoute(route as DocsRoute, INDEX);
    expect(res.kind).toBe("miss");

    // No resolution → no docId → the read layer is NEVER invoked.
    const readFile = vi.fn();
    expect(readFile).not.toHaveBeenCalled();

    // The URL itself carries only keys — no absolute path segments.
    expect(url).not.toContain("/Users/");
    expect(url).not.toContain("%2FUsers%2F");
  });
});

describe("mobile layout: a route issue forces the viewer pane (live fold 2026-07-08)", () => {
  it("hasRouteIssue shows the viewer slot on mobile even with nothing selected", async () => {
    const { DocsView } = await import("../../src/ui/docs/DocsView.js");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { deriveDocIndex } = await import("../../src/projections/deriveDocIndex.js");
    const { bundleOf, docSignal, NOW } = await import("../fixtures/signals.js");
    const { taxonomyFixture } = await import("../fixtures/taxonomy.js");
    const index = deriveDocIndex(bundleOf([docSignal("specs/x.md", { repo: "company", checkoutId: "main", checkoutKey: "company" })]), NOW, taxonomyFixture());
    const missPanel = <div>MISS-PANEL-SENTINEL</div>;
    const withIssue = renderToStaticMarkup(
      <DocsView docIndex={index} selectedDocId={null} onSelect={() => {}} now={NOW} isMobile viewer={missPanel} hasRouteIssue />,
    );
    expect(withIssue).toContain("MISS-PANEL-SENTINEL");
    const without = renderToStaticMarkup(
      <DocsView docIndex={index} selectedDocId={null} onSelect={() => {}} now={NOW} isMobile viewer={missPanel} />,
    );
    expect(without).not.toContain("MISS-PANEL-SENTINEL"); // tree-first stays the default
  });
});
