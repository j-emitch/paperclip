/**
 * Extension seams for COS-1 (teaching) and COS-2 (knowledge / classifier).
 *
 * These are declared — empty — in COS-0b so the later phases ADD new sources and
 * resolvers without editing any existing source or projection (spec §5.1: "the
 * extension seams … are declared (empty) in COS-0"). They exist to:
 *   1. lock the shape COS-1/COS-2 must satisfy, and
 *   2. let `tests/contracts/extension-seams.spec.ts` prove a dummy teaching /
 *      knowledge source emits the SAME typed signals an existing source does —
 *      i.e. the seam composes with the pipeline without special-casing.
 *
 * Nothing here is wired into the worker in COS-0b.
 */

import type { WorkSignalSource } from "./WorkSignalSource.js";
import type { ArtifactSignal, TaxonomySignal } from "./signals.js";
import type { ArtifactType, SignalConfidence } from "./vocab.js";

/**
 * COS-2f: the teaching loop becomes a `WorkSignalSource` — the teaching corpus in
 * `docs/teachings` (inbox / units / synthesis receipts) surfaces as
 * `ArtifactSignal`s (`artifactType: "teaching"`, carrying `TeachingArtifactMeta`).
 * It is a plain source, marked with a discriminant so the Teaching tab can find
 * its batch without coupling to the source's id. Implemented by `TeachingSource`.
 */
export interface TeachingSignalSource extends WorkSignalSource {
  readonly extensionKind: "teaching";
}

/**
 * COS-2: the library/knowledge corpus surfaced as `ArtifactSignal`s
 * (`artifactType: "knowledge"`). Same seam, different discriminant.
 */
export interface KnowledgeSource extends WorkSignalSource {
  readonly extensionKind: "knowledge";
}

/** The richer classification a COS-2 classifier can attach to an artifact. */
export interface ArtifactClassification {
  readonly artifactType: ArtifactType;
  readonly system: string | null;
  readonly prefix: string | null;
  /** 0..1 — how confident the classifier is; bridges to the signal `confidence` band. */
  readonly score: number;
  readonly band: SignalConfidence;
}

/**
 * COS-2: a pluggable artifact classifier (the graphify/library convergence).
 * COS-0 classifies by frontmatter + path; COS-2 can swap in a learned one
 * behind this seam without the artifact source changing.
 */
export interface ArtifactClassifier {
  readonly id: string;
  classify(artifact: ArtifactSignal): Promise<ArtifactClassification>;
}

/**
 * COS-2: resolve a prefix → family → system mapping. COS-0 backs this with the
 * static `prefix-registry.json`; COS-2 can resolve dynamically. Returns null
 * for an unregistered prefix (→ Unclassified, reason `unknown_prefix`).
 */
export interface TaxonomyResolver {
  readonly id: string;
  resolve(prefix: string): Promise<TaxonomySignal | null>;
}

// ---------------------------------------------------------------------------
// COS-3 — Paperclip Write Authority (PWA-01) seam
// ---------------------------------------------------------------------------

/**
 * The WRITE-SIDE complement to the read-only cockpit (handoff
 * `2026-06-23-pwa-01-write-authority-for-cos-session.md`; spec
 * `company/docs/superpowers/specs/2026-06-23-PWA-01-paperclip-write-authority.md`).
 *
 * COS-0 surfaces the work; PWA-01 lets the Paperclip agents *fix the hygiene the
 * board surfaces* (archive shipped backlog, reconcile spec §10 + CONTEXT
 * "What's In Progress", close phantom tickets) under a tiered, evidence-gated,
 * git-reversible authority model. Adopted as **COS-3** in the COS family so it
 * shares THIS signal layer + the routine-contract metadata seam — no second
 * parser, no second registry.
 *
 * Declared here as a FORWARD-COMPAT seam only. PWA-01 is a draft spec (not yet
 * spec-verified) and its tier assignments are Joe's open questions (PWA-01 §12
 * OQ-1/2/3) — so COS-0 encodes the SHAPES, never the policy. A hygiene action is
 * deliberately NOT a member of the core `Signal` union: COS-3 adds its own
 * `HygieneAuditSource` + `HygieneAuditV1` projection + a "Hygiene" tab, leaving
 * every COS-0 source/projection untouched (the same additive rule as COS-1/2).
 */

/** PWA tier — PWA-01 scales it to (risk × irreversibility); the tier model is defined there, not here. */
export type WriteTier = 0 | 1 | 2;

/**
 * One write a Paperclip agent performed — the unit COS-3's Hygiene tab renders.
 *
 * It carries its OWN minimal provenance, deliberately NOT the read-signal
 * `SignalProvenance` envelope: a write-audit record has no confidence /
 * freshness / errors[]. Kept out of the core `Signal` union too, so COS-0's
 * sources + projections stay untouched (COS-3 adds its own audit source +
 * projection + tab).
 */
export interface HygieneActionSignal {
  readonly kind: "hygiene";
  /** The COS-3 HygieneAuditSource id that recorded it. */
  readonly source: string;
  /** Repo the write touched. */
  readonly repo: string;
  /** Owning agent (CEO | COO | CTO | Librarian). */
  readonly actor: string;
  /** The tier this write ran under (PWA-01 defines the tier model). */
  readonly tier: WriteTier;
  /** Allowlisted write surface, e.g. "backlog-archival" | "context-in-progress" | "spec-section-10". */
  readonly surface: string;
  /** Human one-liner ("archived 13 shipped backlog items"). */
  readonly action: string;
  /** Commit sha / PR url / append-only write-log id; null only for a dry-run preview. */
  readonly evidenceRef: string | null;
  /** Whether the write is git-reversible (git mv, PR diff) — PWA-01 ties this to its tier model. */
  readonly reversible: boolean;
  /** ISO-8601 timestamp of the write. */
  readonly at: string;
}

/**
 * The per-agent write-authority stanza COS-3 adds beside routine contracts.
 * The legacy AGENTS parser already tolerates an optional `write_authority:` key,
 * so PWA can land it without breaking activation fallback; COS-0 never populates
 * it and encodes no tier policy.
 */
export interface WriteAuthority {
  readonly tier: WriteTier;
  /** Allowlisted write surfaces this agent may touch. */
  readonly surfaces: readonly string[];
  /** Evidence each write must cite before it is allowed (evidence-or-abort). */
  readonly evidence: readonly string[];
}
