/**
 * `BuildAtlasV1` — the persisted contract for the COS-5 Build Atlas, the live
 * successor to the static build-map prototype. It replaces the Board's Kanban
 * view with a family-centric atlas: every spec-prefix family carries a
 * lifecycle stepper (Spec·Plan·Build·Prod) that is DECOUPLED from its built-%,
 * a built bar, its in-flight builds, its routed LYC tickets, and its lineage
 * tags; families group into domains and into lineage lane-groups (incl. a
 * Second-Brain lane).
 *
 * Same discipline as `board-state.ts` / `agent-system.ts`: zod-first, the
 * TypeScript type is `z.infer`'d from the schema, closed enums are built from
 * `as const` tuples, and compile-time `Expect<AssertEqual<…>>` guards prove the
 * inferred unions still equal those tuples. Atlas-local vocabularies live HERE
 * (mirroring `agent-system.ts`'s local `agentDiagnosticCodes`); only genuinely
 * cross-consumer vocab (e.g. `WorkState`) is imported from `vocab.ts`.
 *
 * The UI renders this verbatim and NEVER derives; `parseBuildAtlasV1` is the
 * read/write gate so a malformed cache row is caught, not rendered.
 */

import { z } from "@paperclipai/plugin-sdk";
import { diagnosticSchema, sourceFreshnessSchema } from "./diagnostics.js";
import {
  LANE_GROUP_KINDS,
  LINEAGE_EDGE_KINDS,
  WORK_STATES,
  type AssertEqual,
  type Expect,
  type LaneGroupKind,
  type LineageEdgeKind,
  type WorkState,
} from "./vocab.js";

/** Bump only on a breaking shape change; the cache row carries it and stale versions re-derive. */
// v2: C2 §2.3 spine fields on FamilyV1 (specStatus/specUpdatedAt/planUpdatedAt/description).
export const BUILD_ATLAS_SCHEMA_VERSION = 2 as const;

// ---------------------------------------------------------------------------
// Atlas-local closed vocabularies (agent-system.ts precedent — kept out of the
// cross-consumer vocab.ts because only the Atlas speaks them)
// ---------------------------------------------------------------------------

/**
 * A lifecycle gate's state on the Spec·Plan·Build·Prod stepper. DECOUPLED from
 * built-% by design: a family can be `prod: active` while `<100%` built (the
 * rolling-program case) — the stepper reflects lifecycle stage, the built bar
 * reflects completion, and the two never contradict.
 */
export const GATE_STATES = ["done", "active", "warn", "todo"] as const;
export type GateState = (typeof GATE_STATES)[number];

/**
 * Plan-coverage state relative to the family's spec. `none` = a spec exists but
 * no plan (the plan-gap pill); `partial` = plan exists but covers less than the
 * spec's ticket surface (resolved once ticket-level data lands in 5c); `authored`
 * = plan present, not yet verified; `approved` = plan_verified set; `ok` = no
 * plan gap applies (e.g. non-spec-driven family).
 */
export const PLAN_STATES = ["ok", "partial", "none", "authored", "approved"] as const;
export type PlanState = (typeof PLAN_STATES)[number];

/** How an LYC ticket was routed into (or held out of) a family (5c three-tier routing). */
export const TICKET_ROUTES = ["family", "routine", "ops"] as const;
export type TicketRoute = (typeof TICKET_ROUTES)[number];

/** Non-fatal Atlas derivation problems surfaced on the diagnostics rail. */
export const atlasDiagnosticCodes = [
  "unknown_prefix", // a work/ticket signal referenced a prefix with no registry family
  "orphan_family", // a family resolved into no lineage lane (5b completeness)
  "broken_edge", // a lineage edge referenced a family not in the family set (5b)
  "unrouted_ticket", // an LYC manual ticket resolved to no family and no routine (5c)
  "export_stale", // the exported ticket bridge is older than its freshness budget (5c)
] as const;
export type AtlasDiagnosticCode = (typeof atlasDiagnosticCodes)[number];

export const atlasDiagnosticSeverities = ["info", "warn"] as const;
export type AtlasDiagnosticSeverity = (typeof atlasDiagnosticSeverities)[number];

// ---------------------------------------------------------------------------
// Enums built from the canonical tuples (single source of truth)
// ---------------------------------------------------------------------------

export const gateStateSchema = z.enum(GATE_STATES);
export const planStateSchema = z.enum(PLAN_STATES);
export const laneGroupKindSchema = z.enum(LANE_GROUP_KINDS);
export const lineageEdgeKindSchema = z.enum(LINEAGE_EDGE_KINDS);
export const ticketRouteSchema = z.enum(TICKET_ROUTES);
export const buildStateSchema = z.enum(WORK_STATES);
export const atlasDiagnosticCodeSchema = z.enum(atlasDiagnosticCodes);
export const atlasDiagnosticSeveritySchema = z.enum(atlasDiagnosticSeverities);

// ---------------------------------------------------------------------------
// Atlas element schemas
// ---------------------------------------------------------------------------

/** The Spec·Plan·Build·Prod lifecycle stepper — each gate independent of built-%. */
export const lifecycleV1Schema = z.object({
  spec: gateStateSchema,
  plan: gateStateSchema,
  build: gateStateSchema,
  prod: gateStateSchema,
  /** Plan-coverage relative to the spec — drives the plan-gap pill. */
  planState: planStateSchema,
});
export type LifecycleV1 = z.infer<typeof lifecycleV1Schema>;

/** One in-flight or shipped build (work item) within a family. */
export const buildV1Schema = z.object({
  /** Ticket id `PREFIX-NN` (or a synthetic id for unticketed work). */
  ticketId: z.string().min(1),
  title: z.string().nullable(),
  /** Work-state column this build occupies. */
  state: buildStateSchema,
  /** Primary repo the build lives in. */
  repo: z.string().min(1),
  sha: z.string().nullable(),
  prNumber: z.number().int().nullable(),
  url: z.string().nullable(),
  updatedAt: z.string().nullable(),
});
export type BuildV1 = z.infer<typeof buildV1Schema>;

/** An LYC ticket routed to a family (5c). */
export const ticketRefV1Schema = z.object({
  identifier: z.string().min(1),
  title: z.string().nullable(),
  status: z.string().nullable(),
  priority: z.string().nullable(),
  /** manual | routine_execution | issue_productivity_review (raw origin). */
  originKind: z.string().nullable(),
  /** How this ticket was routed into the family. */
  route: ticketRouteSchema,
});
export type TicketRefV1 = z.infer<typeof ticketRefV1Schema>;

/** A spec-prefix family — the atlas's primary card. */
export const familyV1Schema = z.object({
  prefix: z.string().min(1),
  name: z.string().min(1),
  /** L1 system (JB | ARC | Company | …). */
  l1: z.string().min(1),
  /** L2 subsystem. */
  l2: z.string().min(1),
  /** Domain the card renders under (currently the L1 system). */
  domain: z.string().min(1),
  /** Home lane id (`l1:l2`) — the Board taxonomy key, shared with the lineage layer. */
  laneId: z.string().min(1),
  /** Repos this family appears in (home repo first). */
  repos: z.array(z.string().min(1)),
  /** True for grandfathered generic prefixes (IMPRV/GAP) — rendered with an anti-pattern marker. */
  isGeneric: z.boolean(),
  /** True for rolling programs (INFRA/PULSE/RE/…) — built bar reads "· live", not a fixed %. */
  isRolling: z.boolean(),
  lifecycle: lifecycleV1Schema,
  /**
   * C2 (§2.3 spine): the family's canonical spec/plan doc metadata — status +
   * last-touch dates (frontmatter `last_updated` ?? file mtime) + the spec's
   * one-line description. Resolved from the NEWEST main-checkout doc of each
   * type; null when the family has no such doc. Drives the description line,
   * the stale-spec chip, and the shipped-build-vs-active-plan lag chip.
   */
  specStatus: z.string().nullable(),
  specUpdatedAt: z.string().nullable(),
  planStatus: z.string().nullable(),
  planUpdatedAt: z.string().nullable(),
  description: z.string().nullable(),
  /** 0–100 completion of the family's builds — the built BAR (independent of the stepper). */
  builtPct: z.number().int().min(0).max(100),
  /** Human built summary ("3 shipped · 1 in progress", or "N shipped · live" for rolling). */
  builtSummary: z.string().min(1),
  builds: z.array(buildV1Schema),
  /** Prefix-pure own tickets (foreign refs become lineage tags, not member tickets). */
  tickets: z.array(ticketRefV1Schema),
  /** Family prefixes this family relates to via the lineage layer (5b). */
  lineageTags: z.array(z.string().min(1)),
});
export type FamilyV1 = z.infer<typeof familyV1Schema>;

/** A top-level domain section grouping families (currently by L1 system). */
export const domainV1Schema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  /** Family prefixes under this domain, in render order. */
  families: z.array(z.string().min(1)),
});
export type DomainV1 = z.infer<typeof domainV1Schema>;

/** One lane within a lineage lane-group. */
export const laneV1Schema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  /** Family prefixes assigned to this lane. */
  families: z.array(z.string().min(1)),
});
export type LaneV1 = z.infer<typeof laneV1Schema>;

/** A lineage lane-group (flow / overlay / second-brain). */
export const laneGroupV1Schema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  kind: laneGroupKindSchema,
  lanes: z.array(laneV1Schema),
});
export type LaneGroupV1 = z.infer<typeof laneGroupV1Schema>;

/** A directed lineage edge between two families. */
export const lineageEdgeV1Schema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  kind: lineageEdgeKindSchema,
});
export type LineageEdgeV1 = z.infer<typeof lineageEdgeV1Schema>;

/** A non-fatal Atlas diagnostic (unknown prefix / broken edge / unrouted ticket / …). */
export const atlasDiagnosticV1Schema = z.object({
  code: atlasDiagnosticCodeSchema,
  severity: atlasDiagnosticSeveritySchema,
  message: z.string(),
  /** The family prefix the diagnostic pertains to; null when global. */
  prefix: z.string().nullable(),
});
export type AtlasDiagnosticV1 = z.infer<typeof atlasDiagnosticV1Schema>;

// ---------------------------------------------------------------------------
// The persisted contract
// ---------------------------------------------------------------------------

export const buildAtlasV1Schema = z.object({
  schemaVersion: z.literal(BUILD_ATLAS_SCHEMA_VERSION),
  /** ISO-8601 derive timestamp. */
  derivedAt: z.string().min(1),
  /** Per-(source, repo) freshness — drives the stale badges. */
  sources: z.array(sourceFreshnessSchema),
  domains: z.array(domainV1Schema),
  families: z.array(familyV1Schema),
  laneGroups: z.array(laneGroupV1Schema),
  edges: z.array(lineageEdgeV1Schema),
  diagnostics: z.array(atlasDiagnosticV1Schema),
  /** Source-freshness-derived diagnostics (shared shape with the Board). */
  sourceDiagnostics: z.array(diagnosticSchema),
});
export type BuildAtlasV1 = z.infer<typeof buildAtlasV1Schema>;

// ---------------------------------------------------------------------------
// Validation gate (cache write + read + worker return)
// ---------------------------------------------------------------------------

/** Parse + validate (throws `ZodError` on a malformed snapshot). Use on cache read. */
export function parseBuildAtlasV1(input: unknown): BuildAtlasV1 {
  return buildAtlasV1Schema.parse(input);
}

/** Non-throwing variant — returns the zod result for callers that handle the bad-row case. */
export function safeParseBuildAtlasV1(input: unknown): z.SafeParseReturnType<unknown, BuildAtlasV1> {
  return buildAtlasV1Schema.safeParse(input);
}

// ---------------------------------------------------------------------------
// Compile-time drift guards — these alias lines fail to compile if a local
// tuple and its atlas-facing union ever diverge.
// ---------------------------------------------------------------------------

type _GateStateMatches = Expect<AssertEqual<z.infer<typeof gateStateSchema>, GateState>>;
type _PlanStateMatches = Expect<AssertEqual<z.infer<typeof planStateSchema>, PlanState>>;
type _LaneGroupKindMatches = Expect<AssertEqual<z.infer<typeof laneGroupKindSchema>, LaneGroupKind>>;
type _LineageEdgeKindMatches = Expect<AssertEqual<z.infer<typeof lineageEdgeKindSchema>, LineageEdgeKind>>;
type _TicketRouteMatches = Expect<AssertEqual<z.infer<typeof ticketRouteSchema>, TicketRoute>>;
type _BuildStateMatches = Expect<AssertEqual<z.infer<typeof buildStateSchema>, WorkState>>;
type _AtlasDiagnosticCodeMatches = Expect<AssertEqual<z.infer<typeof atlasDiagnosticCodeSchema>, AtlasDiagnosticCode>>;
type _AtlasDiagnosticSeverityMatches = Expect<
  AssertEqual<z.infer<typeof atlasDiagnosticSeveritySchema>, AtlasDiagnosticSeverity>
>;
