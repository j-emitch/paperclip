/**
 * Deterministic layout for the Agents org constellation (spec §7.2).
 *
 * The four-agent workforce is a fixed, shallow tree, so the diagram is a PURE
 * function of the agent set + handoffs — no force-directed randomness. Every
 * coordinate is an integer derived from the canonical CEO→COO→CTO→Librarian
 * order and each agent's `reportsTo` depth, so the SSR tree is byte-stable and
 * the Playwright harness screenshots an identical diagram each run. SVG path
 * strings are assembled by `join(" ")` (never adjacent `${a} ${b}` template
 * interpolation, which the writer can corrupt).
 */

import type { AgentCardV1, HandoffEdgeV1, RoutineVerdict } from "../../contracts/index.js";
import { VERDICT_TONES } from "../shared/verdict-labels.js";
import { statusColors } from "../tokens.js";

const OWNER_AGENT_ORDER = ["CEO", "COO", "CTO", "Librarian"] as const;

function rank(name: string): number {
  const i = OWNER_AGENT_ORDER.indexOf(name as (typeof OWNER_AGENT_ORDER)[number]);
  return i === -1 ? OWNER_AGENT_ORDER.length : i;
}

export interface ConstellationNode {
  agentKey: string;
  displayName: string;
  verdict: RoutineVerdict | null;
  tone: string;
  x: number;
  y: number;
  r: number;
  depth: number;
}

export interface ConstellationEdge {
  id: string;
  kind: "lineage" | "handoff";
  from: string;
  to: string;
  consistent: boolean;
  path: string;
}

export interface ConstellationLayout {
  width: number;
  height: number;
  nodes: ConstellationNode[];
  edges: ConstellationEdge[];
  mobile: boolean;
}

const DESKTOP = { width: 760, r: 26, top: 54, row: 150 } as const;
const MOBILE = { width: 320, r: 22, top: 40, row: 84, indent: 30, left: 60 } as const;

function toneFor(verdict: RoutineVerdict | null): string {
  return verdict === null ? statusColors.reviewUnknown : VERDICT_TONES[verdict];
}

function makeResolver(agents: readonly AgentCardV1[]): (ref: string | null) => AgentCardV1 | undefined {
  const byRef = new Map<string, AgentCardV1>();
  for (const agent of agents) {
    byRef.set(agent.displayName, agent);
    byRef.set(agent.agentKey, agent);
  }
  return (ref) => (ref === null ? undefined : byRef.get(ref));
}

function depthOf(agent: AgentCardV1, resolve: (ref: string | null) => AgentCardV1 | undefined, max: number): number {
  let depth = 0;
  let cur: AgentCardV1 | undefined = agent;
  const visited = new Set<string>();
  while (cur && cur.reportsTo) {
    if (visited.has(cur.agentKey)) break; // cycle guard
    visited.add(cur.agentKey);
    const parent = resolve(cur.reportsTo);
    if (!parent || parent.agentKey === cur.agentKey) break;
    depth += 1;
    cur = parent;
    if (depth > max) break; // safety net
  }
  return depth;
}

export function buildConstellationLayout(
  agents: readonly AgentCardV1[],
  handoffs: readonly HandoffEdgeV1[],
  opts: { mobile?: boolean } = {},
): ConstellationLayout {
  const mobile = opts.mobile === true;
  const ordered = [...agents].sort((a, b) => rank(a.displayName) - rank(b.displayName) || a.agentKey.localeCompare(b.agentKey));
  const resolve = makeResolver(ordered);
  const depths = new Map<string, number>();
  for (const agent of ordered) depths.set(agent.agentKey, depthOf(agent, resolve, ordered.length));

  const nodes: ConstellationNode[] = mobile
    ? layoutMobile(ordered, depths)
    : layoutDesktop(ordered, depths);
  const nodeByName = new Map<string, ConstellationNode>();
  for (const node of nodes) {
    nodeByName.set(node.displayName, node);
    nodeByName.set(node.agentKey, node);
  }

  const edges: ConstellationEdge[] = [];
  // Lineage — every report to its manager.
  for (const agent of ordered) {
    if (!agent.reportsTo) continue;
    const child = nodeByName.get(agent.agentKey);
    const parent = nodeByName.get(agent.reportsTo);
    if (!child || !parent) continue;
    edges.push({
      id: "lineage:" + parent.agentKey + ">" + child.agentKey,
      kind: "lineage",
      from: parent.displayName,
      to: child.displayName,
      consistent: true,
      path: lineagePath(parent, child),
    });
  }
  // Hand-offs — desktop only; mobile renders them as a legend beside the stack.
  if (!mobile) {
    for (const handoff of handoffs) {
      const from = nodeByName.get(handoff.from);
      const to = nodeByName.get(handoff.to);
      if (!from || !to) continue;
      edges.push({
        id: "handoff:" + handoff.from + ">" + handoff.to,
        kind: "handoff",
        from: handoff.from,
        to: handoff.to,
        consistent: handoff.consistent,
        path: handoffPath(from, to),
      });
    }
  }

  const maxDepth = Math.max(0, ...ordered.map((a) => depths.get(a.agentKey) ?? 0));
  const height = mobile
    ? MOBILE.top * 2 + MOBILE.r * 2 + Math.max(0, ordered.length - 1) * MOBILE.row
    : DESKTOP.top * 2 + DESKTOP.r * 2 + maxDepth * DESKTOP.row;
  const width = mobile ? MOBILE.width : DESKTOP.width;

  return { width, height, nodes, edges, mobile };
}

function layoutDesktop(ordered: readonly AgentCardV1[], depths: Map<string, number>): ConstellationNode[] {
  const byDepth = new Map<number, AgentCardV1[]>();
  for (const agent of ordered) {
    const depth = depths.get(agent.agentKey) ?? 0;
    const bucket = byDepth.get(depth) ?? [];
    bucket.push(agent);
    byDepth.set(depth, bucket);
  }
  const nodes: ConstellationNode[] = [];
  for (const [depth, tier] of [...byDepth.entries()].sort((a, b) => a[0] - b[0])) {
    const n = tier.length;
    tier.forEach((agent, i) => {
      nodes.push({
        agentKey: agent.agentKey,
        displayName: agent.displayName,
        verdict: agent.healthRollup,
        tone: toneFor(agent.healthRollup),
        x: Math.round((DESKTOP.width * (i + 1)) / (n + 1)),
        y: DESKTOP.top + DESKTOP.r + depth * DESKTOP.row,
        r: DESKTOP.r,
        depth,
      });
    });
  }
  return nodes;
}

function layoutMobile(ordered: readonly AgentCardV1[], depths: Map<string, number>): ConstellationNode[] {
  return ordered.map((agent, k) => {
    const depth = depths.get(agent.agentKey) ?? 0;
    return {
      agentKey: agent.agentKey,
      displayName: agent.displayName,
      verdict: agent.healthRollup,
      tone: toneFor(agent.healthRollup),
      x: MOBILE.left + depth * MOBILE.indent,
      y: MOBILE.top + MOBILE.r + k * MOBILE.row,
      r: MOBILE.r,
      depth,
    };
  });
}

function lineagePath(parent: ConstellationNode, child: ConstellationNode): string {
  const startY = parent.y + parent.r;
  const endY = child.y - child.r;
  const midY = Math.round((startY + endY) / 2);
  return ["M", parent.x, startY, "C", parent.x, midY, child.x, midY, child.x, endY].join(" ");
}

function handoffPath(from: ConstellationNode, to: ConstellationNode): string {
  const bow = rank(from.displayName) <= rank(to.displayName) ? 46 : -46;
  const mx = Math.round((from.x + to.x) / 2 + bow);
  const my = Math.round((from.y + to.y) / 2);
  return ["M", from.x, from.y, "Q", mx, my, to.x, to.y].join(" ");
}
