/**
 * SSR coverage for the Build Atlas view — the authorized Board replacement
 * (COS-5d-b), at Board-parity depth. Renders the pure `BuildAtlasView` with
 * `renderToStaticMarkup` (no host bridge) and asserts every region surfaces:
 * the vitals masthead, the lifecycle legend, the domain sections of family cards
 * (lifecycle stepper + built bar + rolling/generic/plan-gap markers + show-0),
 * the lineage lane-groups (incl. the distinct Second-Brain lane + a pseudo-sink),
 * and the diagnostics rail — plus the three non-data states and the expanded
 * family body. All from a golden derived on the true `deriveBuildAtlas` path.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BuildAtlasView } from "../../src/ui/atlas/BuildAtlasView.js";
import { FamilyCard } from "../../src/ui/atlas/FamilyCard.js";
import { LifecycleStepper } from "../../src/ui/atlas/LifecycleStepper.js";
import { SurfaceEmpty, SurfaceError, SurfaceLoading } from "../../src/ui/shared/surface-state.js";
import { AtlasIcon } from "../../src/ui/icons.js";
import { COCKPIT_MOTION_STYLE_ID } from "../../src/ui/shared/cockpit-motion.js";
import { buildAtlasView, findFamilyForWork, sortDiagnostics } from "../../src/ui/atlas/atlas-view-model.js";
import type { AtlasDiagnosticV1, LifecycleV1 } from "../../src/contracts/build-atlas.js";
import { goldenAtlas, ATLAS_NOW } from "./fixtures/atlas.js";

const noop = () => {};

function render(props: Partial<Parameters<typeof BuildAtlasView>[0]> = {}): string {
  return renderToStaticMarkup(
    <BuildAtlasView
      atlas={props.atlas ?? goldenAtlas()}
      now={props.now ?? ATLAS_NOW}
      isMobile={props.isMobile ?? false}
      onRefresh={props.onRefresh ?? noop}
      refreshing={props.refreshing ?? false}
      refreshError={props.refreshError ?? null}
      focusWorkId={props.focusWorkId ?? null}
    />,
  );
}

describe("BuildAtlasView — masthead + legend", () => {
  const html = render();

  it("renders the title + vitals tiles", () => {
    expect(html).toContain("Build Atlas");
    expect(html).toContain("Families");
    expect(html).toContain("Domains");
    expect(html).toContain("Shipped builds");
    expect(html).toContain("Lineage lanes");
    expect(html).toContain("Diagnostics");
  });

  it("summarises builds + lineage links", () => {
    expect(html).toContain("4 shipped · 7 builds"); // 4 shipped of 7 real builds (XYZ unregistered → excluded)
    expect(html).toContain("lineage link");
  });

  it("shows a live freshness badge when the derive is current", () => {
    expect(html).toContain("Atlas is live");
    expect(html).not.toContain("Atlas is stale");
  });

  it("renders the lifecycle legend that decodes the pips", () => {
    expect(html).toContain("Spec → Plan → Build → Prod");
    expect(html).toContain("needs attention");
    expect(html).toContain("not started");
  });

  it("surfaces the stale source as a pill without blanking the atlas", () => {
    expect(html).toContain("juice-bar"); // the stale-source pill (source · repo · freshness)
    expect(html).toContain("Company OS"); // the atlas still rendered its families
  });

  it("injects the scoped motion stylesheet (incl. reduced-motion) exactly once", () => {
    expect(html).toContain(`id="${COCKPIT_MOTION_STYLE_ID}"`);
    expect(html).toContain("prefers-reduced-motion");
    expect(html.match(new RegExp(COCKPIT_MOTION_STYLE_ID, "g"))?.length).toBe(1);
  });
});

describe("BuildAtlasView — domain sections + family cards", () => {
  const html = render();

  it("renders every domain section (by L1 system)", () => {
    for (const domain of ["ARC", "Company", "JB"]) expect(html).toContain(domain);
  });

  it("renders every family with prefix + name", () => {
    for (const prefix of ["COS", "MTP", "TPR", "PULSE", "IMPRV", "LDI", "META"]) expect(html).toContain(prefix);
    // "Meta · Routines & Ops" renders with the ampersand HTML-escaped (&amp;), so match the stable prefix.
    for (const name of ["Company OS", "Coaching", "Tap Redesign", "Pulse", "Improvements", "Data Ingest", "Meta · Routines"]) {
      expect(html).toContain(name);
    }
  });

  it("shows the built summary per family — fixed ratio, rolling · live, and show-0", () => {
    expect(html).toContain("1/3 shipped"); // COS: 1 of 3 built
    expect(html).toContain("1 shipped · live"); // PULSE: rolling program
    expect(html).toContain("no builds yet"); // TPR: registered, zero builds (show-0)
    expect(html).toContain("1 routine · 1 unrouted"); // Meta family summary
  });

  it("flags the generic prefix as an anti-pattern (icon-only marker has an aria-label)", () => {
    expect(html).toContain("generic prefix — anti-pattern; prefer a specific family");
  });

  it("surfaces the plan-gap pill for a spec-with-no-plan family", () => {
    expect(html).toContain("no plan"); // MTP: verified spec, no plan
  });
});

describe("BuildAtlasView — lineage", () => {
  const html = render();

  it("renders the lane-groups incl. the distinct Second-Brain lane", () => {
    expect(html).toContain("Value Chain");
    expect(html).toContain("Second Brain");
    expect(html).toContain("value chain"); // kind label
    expect(html).toContain("second brain");
  });

  it("renders each lane with its family nodes", () => {
    for (const lane of ["Coaching", "Observability"]) expect(html).toContain(lane);
  });

  it("marks a pseudo-sink (COS receives but never emits)", () => {
    expect(html).toContain("pseudo-sink");
  });
});

describe("BuildAtlasView — diagnostics rail", () => {
  const html = render();

  it("surfaces every diagnostic class", () => {
    expect(html).toContain("unregistered prefix"); // unknown_prefix (XYZ work + ZZZ ticket ref)
    expect(html).toContain("no lineage lane"); // orphan_family (IMPRV / LDI)
    expect(html).toContain("parked in Meta·Ops"); // unrouted_ticket (LYC-200)
    expect(html).toContain("source diagnostic"); // the stale-source rollup line
  });

  it("shows a non-colour severity label + the diagnostic code (a11y color-not-only)", () => {
    expect(html).toContain("unknown_prefix"); // the code label
    expect(html).toContain("orphan_family");
    expect(html).toContain("unrouted_ticket");
    expect(html).toContain("warn"); // the severity pill text (a non-colour cue)
    expect(html).toContain("info");
  });

  it("orders warn rows before info rows (worst-first) in the rendered rail", () => {
    const firstWarn = html.indexOf("unknown_prefix"); // a warn code
    const firstInfo = html.indexOf("orphan_family"); // an info code
    expect(firstWarn).toBeGreaterThanOrEqual(0);
    expect(firstInfo).toBeGreaterThan(firstWarn);
  });
});

describe("BuildAtlasView — freshness + mobile + refresh error", () => {
  it("shows the stale badge when the derive is older than the threshold", () => {
    const html = render({ now: ATLAS_NOW + 10 * 60 * 1000 });
    expect(html).toContain("Atlas is stale");
  });

  it("renders on mobile without crashing", () => {
    const html = render({ isMobile: true });
    expect(html).toContain("Build Atlas");
    expect(html).toContain("Company OS");
  });

  it("shows a refresh-error bar over the last-good snapshot", () => {
    const html = render({ refreshError: "worker timed out" });
    expect(html).toContain("Refresh failed");
    expect(html).toContain("worker timed out");
    expect(html).toContain("Company OS"); // the atlas is still shown
  });
});

describe("FamilyCard — expanded body", () => {
  function expanded(prefix: string): string {
    const family = goldenAtlas().families.find((f) => f.prefix === prefix)!;
    return renderToStaticMarkup(<FamilyCard family={family} now={ATLAS_NOW} defaultExpanded />);
  }

  it("renders the COS builds as state-coloured chips with PR links", () => {
    const html = expanded("COS");
    expect(html).toContain("Builds");
    expect(html).toContain("COS-0");
    expect(html).toContain("Shipped");
    expect(html).toContain("In progress");
    expect(html).toContain("In review");
    expect(html).toContain("https://github.com/lycaon/company/pull/196"); // PR deep-link
  });

  it("renders the routed prefix-pure ticket", () => {
    const html = expanded("COS");
    expect(html).toContain("Tickets");
    expect(html).toContain("LYC-100");
  });

  it("renders lineage tags to related families", () => {
    const html = expanded("COS");
    expect(html).toContain("Related");
    expect(html).toContain("MTP"); // COS ↔ MTP lineage
  });

  it("renders a calm show-0 note for a zero-build family", () => {
    const html = expanded("TPR");
    expect(html).toContain("No builds yet");
  });

  it("renders the Meta family's routine chip + unrouted ticket", () => {
    const html = expanded("META");
    expect(html).toContain("Librarian knowledge audit"); // collapsed routine chip title
    expect(html).toContain("run"); // "· 1 run"
    expect(html).toContain("LYC-200"); // the ops ticket
  });
});

describe("LifecycleStepper", () => {
  const done: LifecycleV1 = { spec: "done", plan: "done", build: "active", prod: "todo", planState: "approved" };
  const gap: LifecycleV1 = { spec: "done", plan: "warn", build: "todo", prod: "todo", planState: "none" };

  it("renders gate labels at full size + a lifecycle aria summary", () => {
    const html = renderToStaticMarkup(<LifecycleStepper lifecycle={done} size="full" />);
    for (const label of ["Spec", "Plan", "Build", "Prod"]) expect(html).toContain(label);
    expect(html).toContain("Lifecycle — Spec done, Plan done, Build in progress, Prod not started");
  });

  it("shows the plan-gap pill for a spec-with-no-plan lifecycle", () => {
    const html = renderToStaticMarkup(<LifecycleStepper lifecycle={gap} size="compact" />);
    expect(html).toContain("no plan");
  });

  it("shows a rolling '· live' tail when isRolling", () => {
    const html = renderToStaticMarkup(<LifecycleStepper lifecycle={done} isRolling size="full" />);
    expect(html).toContain("live");
    expect(html).toContain("rolling program (live)");
  });

  it("mini size is pips-only (no gate labels) but keeps the aria summary", () => {
    const html = renderToStaticMarkup(<LifecycleStepper lifecycle={done} size="mini" />);
    expect(html).toContain("Lifecycle — Spec done");
    expect(html).not.toContain(">Spec<"); // no visible label text node at mini size
  });
});

describe("sortDiagnostics — deterministic total order (view-model)", () => {
  it("orders warn before info, then by code, then prefix (nulls last), then message", () => {
    const diags: AtlasDiagnosticV1[] = [
      { code: "orphan_family", severity: "info", message: "b", prefix: "ZZ" },
      { code: "unknown_prefix", severity: "warn", message: "m", prefix: "BB" },
      { code: "unknown_prefix", severity: "warn", message: "m", prefix: null },
      { code: "unknown_prefix", severity: "warn", message: "m", prefix: "AA" },
      { code: "orphan_family", severity: "info", message: "a", prefix: "ZZ" },
    ];
    expect(sortDiagnostics(diags).map((d) => [d.severity, d.code, d.prefix, d.message])).toEqual([
      ["warn", "unknown_prefix", "AA", "m"],
      ["warn", "unknown_prefix", "BB", "m"],
      ["warn", "unknown_prefix", null, "m"], // a null (global) prefix sorts last within its code
      ["info", "orphan_family", "ZZ", "a"], // message "a" before "b"
      ["info", "orphan_family", "ZZ", "b"],
    ]);
  });

  it("buildAtlasView exposes the sorted diagnostics + severity counts (warn-first)", () => {
    const view = buildAtlasView(goldenAtlas());
    expect(view.diagnostics.warnCount).toBe(3); // unknown_prefix ×2 (XYZ, ZZZ) + unrouted_ticket
    expect(view.diagnostics.infoCount).toBe(2); // orphan_family ×2 (IMPRV, LDI)
    expect(view.diagnostics.sorted.map((d) => d.severity)).toEqual(["warn", "warn", "warn", "info", "info"]);
  });
});

describe("BuildAtlasView — board deep-link focus (B1)", () => {
  it("findFamilyForWork resolves a build ticketId to its family", () => {
    expect(findFamilyForWork(goldenAtlas(), "COS-1")).toBe("COS");
    expect(findFamilyForWork(goldenAtlas(), "LDI-12")).toBe("LDI");
  });

  it("findFamilyForWork falls back to the workId's own prefix for unrouted tickets", () => {
    expect(findFamilyForWork(goldenAtlas(), "COS-999")).toBe("COS");
  });

  it("findFamilyForWork returns a typed miss for unknown ids + routine keys", () => {
    expect(findFamilyForWork(goldenAtlas(), "NOPE-1")).toBeNull();
    expect(findFamilyForWork(goldenAtlas(), "daily-standup")).toBeNull();
  });

  it("a matched focus expands its family card with the accent treatment", () => {
    const html = render({ focusWorkId: "COS-1" });
    expect(html).toContain("data-focused");
    expect(html).not.toContain("isn’t on the atlas");
  });

  it("a missed focus renders the typed miss note and the full atlas", () => {
    const html = render({ focusWorkId: "NOPE-1" });
    expect(html).toContain("isn’t on the atlas");
    expect(html).toContain("NOPE-1");
    expect(html).not.toContain("data-focused");
    expect(html).toContain("Company OS"); // atlas still rendered
  });

  it("no focus renders neither the note nor a focused card", () => {
    const html = render();
    expect(html).not.toContain("isn’t on the atlas");
    expect(html).not.toContain("data-focused");
  });
});

describe("Atlas non-data states", () => {
  it("LoadingState announces politely + has a labelled spinner", () => {
    const html = renderToStaticMarkup(<SurfaceLoading label="Loading the Build Atlas…" />);
    expect(html).toContain("Loading the Build Atlas");
    expect(html).toContain('aria-label="Loading"');
    expect(html).toContain("prefers-reduced-motion");
  });

  it("ErrorState shows the message + a retry control", () => {
    const html = renderToStaticMarkup(<SurfaceError message="worker offline" onRetry={noop} />);
    expect(html).toContain("Couldn’t reach the worker");
    expect(html).toContain("worker offline");
    expect(html).toContain("Try again");
  });

  it("EmptyState explains the auto-fill + offers a derive", () => {
    const html = renderToStaticMarkup(
      <SurfaceEmpty icon={<AtlasIcon size={24} />} title="No atlas yet" body="The cockpit hasn’t derived any families yet." onRefresh={noop} />,
    );
    expect(html).toContain("No atlas yet");
    expect(html).toContain("Refresh");
  });
});

describe("Atlas masthead diagnostics tint (B11)", () => {
  it("info-only diagnostics do NOT tint the masthead tile (one severity ladder)", () => {
    const infoOnly = { ...goldenAtlas(), diagnostics: goldenAtlas().diagnostics.filter((d) => d.severity === "info") };
    const view = buildAtlasView(infoOnly);
    expect(view.vitals.diagnosticsCount).toBeGreaterThan(0); // count still shows
    expect(view.vitals.diagnosticsTinted).toBe(false);
  });

  it("a warn diagnostic tints", () => {
    expect(buildAtlasView(goldenAtlas()).vitals.diagnosticsTinted).toBe(true); // golden has 3 warns
  });
});
