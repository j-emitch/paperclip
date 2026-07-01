/**
 * `AgentConstellation` — the org-chart hero of the Agents cockpit (spec §7.2). A
 * fixed-layout SVG node/edge diagram: the CEO at the apex, each report on its
 * `reportsTo` tier joined by lineage paths, and `handoffs[]` as curved connectors
 * (inconsistent → dashed amber). Each node is a health-tinted sigil ring with a
 * slow heartbeat pulse. Selection is a PROP (not internal click state) so the SSR
 * tree is deterministic; the selected node brightens and its peers dim. All
 * motion is `prefers-reduced-motion`-gated in `cockpit-motion`.
 */

import type { AgentCardV1, HandoffEdgeV1 } from "../../contracts/index.js";
import { tokens, statusColors } from "../tokens.js";
import { withAlpha } from "../shared/color.js";
import { buildConstellationLayout, type ConstellationNode } from "./constellation-layout.js";

export interface AgentConstellationProps {
  agents: readonly AgentCardV1[];
  handoffs: readonly HandoffEdgeV1[];
  selectedAgentKey?: string | null;
  onSelectAgent?: (agentKey: string | null) => void;
  isMobile?: boolean;
}

const HANDOFF_OK = tokens.accent;
const HANDOFF_MISMATCH = statusColors.revise; // amber

export function AgentConstellation({ agents, handoffs, selectedAgentKey = null, onSelectAgent, isMobile = false }: AgentConstellationProps) {
  const layout = buildConstellationLayout(agents, handoffs, { mobile: isMobile });
  const interactive = typeof onSelectAgent === "function";
  const hasSelection = selectedAgentKey !== null;
  const selectedName = agents.find((a) => a.agentKey === selectedAgentKey)?.displayName ?? null;
  const viewBox = "0 0 " + layout.width + " " + layout.height;

  return (
    <div
      data-selected-agent={selectedAgentKey ?? undefined}
      style={{
        background: "radial-gradient(120% 90% at 50% 0%, " + withAlpha(tokens.accent, 0.06) + ", " + tokens.card + " 62%)",
        border: `1px solid ${tokens.border}`,
        borderRadius: tokens.radius,
        padding: isMobile ? 12 : 18,
        overflow: "hidden",
      }}
    >
      {/* A flattening `img` role would hide the interactive nodes from assistive
          tech; when the nodes are focusable buttons use a non-flattening `group`
          so they stay in the a11y tree. Static → a single labelled image. */}
      <svg
        viewBox={viewBox}
        width="100%"
        height={layout.height}
        role={interactive ? "group" : "img"}
        aria-label="Agent org constellation — CEO, COO, CTO, and Librarian with their reporting lines and hand-offs"
        style={{ display: "block", maxWidth: "100%" }}
      >
        <defs>
          <marker id="cos-arrow-ok" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0 1 L9 5 L0 9 z" fill={HANDOFF_OK} />
          </marker>
          <marker id="cos-arrow-mismatch" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0 1 L9 5 L0 9 z" fill={HANDOFF_MISMATCH} />
          </marker>
        </defs>

        <g>
          {layout.edges
            .filter((e) => e.kind === "lineage")
            .map((edge) => {
              const active = !hasSelection || edge.from === selectedName || edge.to === selectedName;
              return (
                <path
                  key={edge.id}
                  d={edge.path}
                  fill="none"
                  stroke={tokens.border}
                  strokeWidth={1.5}
                  style={{ opacity: active ? 0.9 : 0.3, transition: "opacity 180ms ease" }}
                />
              );
            })}
          {layout.edges
            .filter((e) => e.kind === "handoff")
            .map((edge) => {
              const active = !hasSelection || edge.from === selectedName || edge.to === selectedName;
              const tone = edge.consistent ? HANDOFF_OK : HANDOFF_MISMATCH;
              return (
                <path
                  key={edge.id}
                  d={edge.path}
                  fill="none"
                  stroke={tone}
                  strokeWidth={edge.consistent ? 1.75 : 1.5}
                  strokeDasharray={edge.consistent ? undefined : "5 4"}
                  markerEnd={edge.consistent ? "url(#cos-arrow-ok)" : "url(#cos-arrow-mismatch)"}
                  style={{ opacity: active ? 0.95 : 0.22, transition: "opacity 180ms ease" }}
                />
              );
            })}
        </g>

        <g>
          {layout.nodes.map((node) => (
            <ConstellationNodeMark
              key={node.agentKey}
              node={node}
              mobile={isMobile}
              selected={node.agentKey === selectedAgentKey}
              dimmed={hasSelection && node.agentKey !== selectedAgentKey}
              onSelect={onSelectAgent}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}

function ConstellationNodeMark({
  node,
  mobile,
  selected,
  dimmed,
  onSelect,
}: {
  node: ConstellationNode;
  mobile: boolean;
  selected: boolean;
  dimmed: boolean;
  onSelect?: (agentKey: string | null) => void;
}) {
  const labelX = mobile ? node.x + node.r + 10 : node.x;
  const labelY = mobile ? node.y + 4 : node.y + node.r + 15;
  const clickable = typeof onSelect === "function";
  return (
    <g
      role={clickable ? "button" : undefined}
      aria-label={node.displayName + " — health " + (node.verdict ?? "duties only")}
      aria-pressed={clickable ? selected : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? () => onSelect?.(selected ? null : node.agentKey) : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              // A role=button node must activate on Enter/Space, not just click (codex A).
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect?.(selected ? null : node.agentKey);
              }
            }
          : undefined
      }
      style={{ cursor: clickable ? "pointer" : "default", opacity: dimmed ? 0.5 : 1, transition: "opacity 180ms ease" }}
    >
      {/* Soft tone-tinted glow disc — gives each node presence in the field. */}
      <circle cx={node.x} cy={node.y} r={node.r + 14} fill={withAlpha(node.tone, 0.1)} />
      {/* Slow health-tinted heartbeat pulse (opacity-only; reduced-motion → static). */}
      <circle cx={node.x} cy={node.y} r={node.r + 5} fill="none" stroke={node.tone} strokeWidth={1.5} className="cos-fx-agent-pulse" style={{ opacity: 0.22 }} />
      {/* Selection halo. */}
      {selected ? <circle cx={node.x} cy={node.y} r={node.r + 9} fill="none" stroke={node.tone} strokeWidth={1.5} style={{ opacity: 0.5 }} /> : null}
      <circle cx={node.x} cy={node.y} r={node.r} fill={tokens.cardElevated} stroke={node.tone} strokeWidth={selected ? 3 : 2} />
      <text x={node.x} y={node.y + 5} textAnchor="middle" fontSize={15} fontWeight={700} fill={tokens.fg} style={{ fontFamily: tokens.font }}>
        {node.displayName.slice(0, 2)}
      </text>
      {/* Health dot at the ring's shoulder. */}
      <circle cx={node.x + node.r * 0.72} cy={node.y - node.r * 0.72} r={4} fill={node.tone} stroke={tokens.card} strokeWidth={1.5} />
      <text
        x={labelX}
        y={labelY}
        textAnchor={mobile ? "start" : "middle"}
        fontSize={12}
        fontWeight={selected ? 700 : 600}
        fill={selected ? tokens.fg : tokens.muted}
        style={{ fontFamily: tokens.font }}
      >
        {node.displayName}
      </text>
    </g>
  );
}
