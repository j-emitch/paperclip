/**
 * `DiagnosticsStrip` — the SHARED derive-diagnostics renderer (B2). One frame
 * for "what degraded on this derive", worst severity first, collapsible past
 * the first three rows (`<details>`, CSS-only — SSR-faithful like the
 * FamilyCard expand). Home renders it under the metrics strip; any surface
 * with a `Diagnostic[]` can adopt it instead of growing a bespoke rail.
 *
 * Empty input renders a single calm all-clear line (Joe: show the 0, don't
 * hide the state). Severity tones ride the ONE ladder: error → danger,
 * warn → revise, info → proceed (B11 uses the same mapping for tints).
 */

import type { Diagnostic } from "../../contracts/diagnostics.js";
import { statusColors, tokens } from "../tokens.js";
import { withAlpha } from "./color.js";
import { Pill } from "./badges.js";
import { CalmNote } from "./feedback.js";

const LEVEL_RANK: Record<Diagnostic["level"], number> = { error: 0, warn: 1, info: 2 };
const LEVEL_TONE: Record<Diagnostic["level"], string> = {
  error: statusColors.danger,
  warn: statusColors.revise,
  info: statusColors.proceed,
};

/** Worst-first, then stable by code (deterministic snapshots). */
export function sortDiagnosticsWorstFirst(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  return [...diagnostics].sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || a.code.localeCompare(b.code));
}

const VISIBLE_ROWS = 3;

export function DiagnosticsStrip({ diagnostics }: { diagnostics: readonly Diagnostic[] }) {
  if (diagnostics.length === 0) {
    return <CalmNote tone={statusColors.ship}>No derive diagnostics — every source read clean.</CalmNote>;
  }
  const sorted = sortDiagnosticsWorstFirst(diagnostics);
  const visible = sorted.slice(0, VISIBLE_ROWS);
  const overflow = sorted.slice(VISIBLE_ROWS);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        {visible.map((diag, i) => (
          <DiagnosticStripRow key={`${diag.code}:${diag.repo ?? "_"}:${i}`} diag={diag} />
        ))}
      </ul>
      {overflow.length > 0 ? (
        <details>
          <summary
            className="cos-fx-summary"
            style={{ cursor: "pointer", listStyle: "none", fontSize: 12, color: tokens.muted, padding: "2px 2px" }}
          >
            {overflow.length} more diagnostic{overflow.length === 1 ? "" : "s"}…
          </summary>
          <ul style={{ listStyle: "none", margin: "6px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            {overflow.map((diag, i) => (
              <DiagnosticStripRow key={`${diag.code}:${diag.repo ?? "_"}:${VISIBLE_ROWS + i}`} diag={diag} />
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function DiagnosticStripRow({ diag }: { diag: Diagnostic }) {
  const tone = LEVEL_TONE[diag.level];
  return (
    <li
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        padding: "6px 10px",
        borderRadius: tokens.radiusSm,
        background: withAlpha(tone, 0.09),
        border: `1px solid ${withAlpha(tone, 0.3)}`,
        fontSize: 12.5,
        color: tokens.fg,
      }}
    >
      {/* Text severity label — level reads without relying on hue (WCAG color-not-only). */}
      <Pill label={diag.level} tone={tone} soft style={{ flex: "0 0 auto", textTransform: "uppercase", letterSpacing: 0.3 }} />
      <span style={{ minWidth: 0, paddingTop: 1 }}>
        <code style={{ fontFamily: tokens.mono, fontSize: 11, color: tokens.muted, marginRight: 6 }}>{diag.code}</code>
        {diag.repo ? <strong style={{ fontFamily: tokens.mono, fontWeight: 700, marginRight: 6 }}>{diag.repo}</strong> : null}
        {diag.message}
      </span>
    </li>
  );
}
