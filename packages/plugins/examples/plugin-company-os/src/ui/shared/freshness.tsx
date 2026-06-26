/**
 * `StaleSourcePills` — the honest-degradation cluster shown in a surface header
 * when one or more underlying sources isn't `live` (cached/stale). Home and Source
 * both embed their projection's `sources[]`, so this renders the same right-aligned
 * "source freshness" badges on both. Returns null when everything is live (no
 * badge noise on a clean read). Pure + deterministic.
 */

import type { SourceFreshness } from "../../contracts/index.js";
import { tokens } from "../tokens.js";
import { Pill } from "./badges.js";

export function StaleSourcePills({ sources }: { sources: readonly SourceFreshness[] }) {
  const stale = sources.filter((s) => s.freshness !== "live");
  if (stale.length === 0) return null;
  return (
    <div style={{ marginLeft: "auto", display: "flex", gap: 6, flexWrap: "wrap" }}>
      {stale.map((s) => (
        <Pill
          key={`${s.source}:${s.repo}`}
          label={`${s.source} ${s.freshness}`}
          tone={tokens.muted}
          withDot
          title={s.message ?? `${s.source} · ${s.repo} is ${s.freshness}`}
        />
      ))}
    </div>
  );
}
