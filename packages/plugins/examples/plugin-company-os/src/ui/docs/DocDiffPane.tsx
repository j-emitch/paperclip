/**
 * `DocDiffPane` — the doc copy's diff vs trunk (COS-8f T4), rendered under the
 * viewer when the header toggle is open. Pure + SSR-faithful: the connected
 * wrapper in `Docs.tsx` feeds it the `doc-diff` payload. States: unified diff
 * (with `--stat` summary + per-line add/del tinting), whole-file-new
 * (untracked), unchanged, truncated notice, and the typed
 * checkout_gone / git_error / loading frames.
 */

import type { DocDiffV1 } from "../../contracts/index.js";
import { statusColors, tokens } from "../tokens.js";
import { CalmNote } from "../shared/feedback.js";

function DiffBody({ diff }: { diff: string }) {
  return (
    <pre
      style={{
        margin: 0,
        padding: 14,
        background: tokens.bg,
        border: `1px solid ${tokens.border}`,
        borderRadius: tokens.radiusSm,
        overflowX: "auto",
        fontFamily: tokens.mono,
        fontSize: 12,
        lineHeight: 1.55,
        minWidth: 0,
      }}
    >
      {diff.split("\n").map((line, i) => {
        const color = line.startsWith("+") ? statusColors.ship : line.startsWith("-") ? statusColors.danger : tokens.muted;
        return (
          <span key={i} style={{ display: "block", color, whiteSpace: "pre" }}>
            {line || " "}
          </span>
        );
      })}
    </pre>
  );
}

export function DocDiffPane({ diff, loading, error }: { diff: DocDiffV1 | null; loading: boolean; error: string | null }) {
  if (loading && !diff) return <CalmNote>Computing the diff vs trunk…</CalmNote>;
  if (error && !diff) return <CalmNote>Couldn’t compute the diff — {error}</CalmNote>;
  if (!diff) return null;

  if (diff.status === "checkout_gone") {
    return <CalmNote>This checkout no longer exists — the worktree was removed since the last index.</CalmNote>;
  }
  if (diff.status !== "ok") {
    return <CalmNote>{diff.message ?? "Couldn’t compute the diff for this document."}</CalmNote>;
  }

  return (
    <section aria-label="Diff vs trunk" style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, fontWeight: 650, color: tokens.fg }}>
          {diff.kind === "untracked_new" ? "Whole file is new (untracked)" : diff.kind === "unchanged" ? "No difference vs trunk" : "Diff vs trunk"}
        </span>
        {diff.stat ? (
          <code style={{ fontFamily: tokens.mono, fontSize: 11, color: tokens.muted }}>{diff.stat.split("\n").at(-1)?.trim()}</code>
        ) : null}
        {diff.truncated ? (
          <span style={{ fontSize: 11.5, color: statusColors.reviewUnknown }}>truncated at 256KB — open the file for the full diff</span>
        ) : null}
      </div>
      {diff.kind === "unchanged" ? (
        <CalmNote>This copy is byte-identical to trunk.</CalmNote>
      ) : diff.diff ? (
        <DiffBody diff={diff.diff} />
      ) : null}
    </section>
  );
}
