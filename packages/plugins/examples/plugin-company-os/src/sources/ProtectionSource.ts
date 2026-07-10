/**
 * `ProtectionSource` (COS-11) — reads branch-protection-as-code DESIRED state
 * from the company repo (`config/branch-protection/repos.json` manifest + one
 * PUT-body JSON per managed repo) and emits one `ProtectionSignal` per manifest
 * entry. `verifiedAt` is ALWAYS null today: no assert-branch-protection receipt
 * file exists yet, and null renders as the honest "never verified against live"
 * warn tier — NOT silent-green (ground-truthed 2026-07-09; the reconciler
 * writes no artifact on `check`).
 *
 * Single-repo pattern (LineageSource): reads only when `company` is responsible.
 * An unparseable manifest degrades company freshness and emits nothing; an
 * unreadable INDIVIDUAL config degrades but keeps the other repos' signals.
 */

import { findRepoRoot, reposResponsibleFor, signalError, type CollectionContext } from "../contracts/collection-context.js";
import type { SignalBatch, WorkSignalSource } from "../contracts/WorkSignalSource.js";
import type { ProtectionSignal, Signal, SignalError } from "../contracts/signals.js";
import { GATES_COMPANY_REPO, PROTECTION_MANIFEST } from "../contracts/gates.js";
import { nowIso, readError } from "./_shared.js";

export const PROTECTION_SOURCE_ID = "protection";

/** Manifest dir — individual `config` filenames resolve relative to it. */
const PROTECTION_DIR = "config/branch-protection";

interface ManifestEntry {
  readonly repoName: string;
  readonly slug: string;
  readonly branch: string;
  readonly configRelPath: string;
}

/** Parse repos.json (`{ repos: { <name>: { slug, branch, config } } }`); null on shape mismatch. */
export function parseProtectionManifest(text: string): ManifestEntry[] | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const repos = (raw as Record<string, unknown>).repos;
  if (typeof repos !== "object" || repos === null) return null;
  const entries: ManifestEntry[] = [];
  for (const [repoName, v] of Object.entries(repos as Record<string, unknown>)) {
    if (typeof v !== "object" || v === null) return null;
    const o = v as Record<string, unknown>;
    if (typeof o.slug !== "string" || typeof o.branch !== "string" || typeof o.config !== "string") return null;
    entries.push({ repoName, slug: o.slug, branch: o.branch, configRelPath: `${PROTECTION_DIR}/${o.config}` });
  }
  return entries;
}

interface ParsedProtection {
  readonly enforceAdmins: boolean | null;
  readonly requiredChecks: readonly string[];
  readonly requiredReviews: number | null;
}

/** Lift the three gate-relevant fields out of a protection PUT body; null on non-JSON. */
export function parseProtectionConfig(text: string): ParsedProtection | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const enforceAdmins = typeof o.enforce_admins === "boolean" ? o.enforce_admins : null;
  const requiredChecks: string[] = [];
  const rsc = o.required_status_checks;
  if (typeof rsc === "object" && rsc !== null) {
    const checks = (rsc as Record<string, unknown>).checks;
    if (Array.isArray(checks)) {
      for (const c of checks) {
        if (typeof c === "object" && c !== null && typeof (c as Record<string, unknown>).context === "string") {
          requiredChecks.push((c as Record<string, unknown>).context as string);
        }
      }
    }
  }
  let requiredReviews: number | null = null;
  const rpr = o.required_pull_request_reviews;
  if (typeof rpr === "object" && rpr !== null) {
    const n = (rpr as Record<string, unknown>).required_approving_review_count;
    if (typeof n === "number" && Number.isFinite(n)) requiredReviews = n;
  }
  return { enforceAdmins, requiredChecks, requiredReviews };
}

export const protectionSource: WorkSignalSource = {
  id: PROTECTION_SOURCE_ID,
  async collect(ctx: CollectionContext): Promise<SignalBatch> {
    const collectedAt = ctx.clock.now();
    if (!reposResponsibleFor(ctx).some((r) => r.repo === GATES_COMPANY_REPO)) {
      return { source: PROTECTION_SOURCE_ID, collectedAt, signals: [], repoFreshness: [] };
    }
    const root = findRepoRoot(ctx, GATES_COMPANY_REPO);
    const stale = (errors: readonly SignalError[]): SignalBatch => ({
      source: PROTECTION_SOURCE_ID,
      collectedAt,
      signals: [],
      repoFreshness: [{ repo: GATES_COMPANY_REPO, freshness: "stale", lastOkAt: null, errors }],
    });
    if (!root || !root.available) {
      return stale([signalError("repo_unavailable", `${GATES_COMPANY_REPO} unavailable; protection not refreshed`)]);
    }

    let manifestText: string;
    try {
      manifestText = await ctx.fs.readText(GATES_COMPANY_REPO, PROTECTION_MANIFEST);
    } catch (e) {
      return stale([readError(PROTECTION_MANIFEST, e)]);
    }
    const manifest = parseProtectionManifest(manifestText);
    if (manifest === null) {
      return stale([signalError("parse_error", `unparseable protection manifest: ${PROTECTION_MANIFEST}`)]);
    }

    const errors: SignalError[] = [];
    const signals: Signal[] = [];
    for (const entry of manifest) {
      let parsed: ParsedProtection | null = null;
      try {
        parsed = parseProtectionConfig(await ctx.fs.readText(GATES_COMPANY_REPO, entry.configRelPath));
      } catch (e) {
        errors.push(readError(entry.configRelPath, e));
        continue;
      }
      if (parsed === null) {
        errors.push(signalError("parse_error", `unparseable protection config: ${entry.configRelPath}`));
        continue;
      }
      const signal: ProtectionSignal = {
        kind: "protection",
        source: PROTECTION_SOURCE_ID,
        repo: GATES_COMPANY_REPO,
        confidence: "high",
        freshness: "live",
        errors: [],
        repoName: entry.repoName,
        slug: entry.slug,
        branch: entry.branch,
        enforceAdmins: parsed.enforceAdmins,
        requiredChecks: parsed.requiredChecks,
        requiredReviews: parsed.requiredReviews,
        verifiedAt: null,
      };
      signals.push(signal);
    }

    const degraded = errors.some((e) => e.degraded);
    return {
      source: PROTECTION_SOURCE_ID,
      collectedAt,
      signals,
      repoFreshness: [
        { repo: GATES_COMPANY_REPO, freshness: degraded ? "stale" : "live", lastOkAt: degraded ? null : nowIso(ctx), errors },
      ],
    };
  },
};
