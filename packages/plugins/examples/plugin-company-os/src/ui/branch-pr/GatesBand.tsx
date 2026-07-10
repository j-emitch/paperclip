/**
 * `GatesBand` (COS-11) — the Branch·PR masthead strip rendering `GatesStateV1`:
 * every gate in the pipeline gets a visible posture, and every degraded state
 * renders EXPLICITLY (last-good marker, "never verified", truncation watermark)
 * — never silent-green.
 *
 * Collapsed = one summary row of chips (worst state per gate family).
 * Expanded = per-repo hooks rows, per-target migration posture, protection
 * desired-state rows, and the two dispatch ledgers. Pure view exported for
 * tests; the connected wrapper owns the `gates-state` fetch and stays quiet
 * (a thin muted line) while gates data is absent — the masthead must never
 * displace the branch board with a loading frame.
 */

import { useState, type ReactNode } from "react";
import type { GatesStateV1, LedgerV1, MigrationTargetV1, ProtectionRepoV1, RepoHooksV1 } from "../../contracts/gates-state.js";
import { tokens, springTransition, statusColors } from "../tokens.js";
import { Pill } from "../shared/badges.js";
import { relativeTime } from "../shared/time.js";
import { useGatesState } from "../hooks/useGatesState.js";

const PARITY_TONES: Record<RepoHooksV1["parity"], string> = {
  in_sync: statusColors.ship,
  drifted: statusColors.revise,
  missing: statusColors.danger,
  unknown: statusColors.reviewUnknown,
};

const PARITY_LABELS: Record<RepoHooksV1["parity"], string> = {
  in_sync: "in sync",
  drifted: "drifted",
  missing: "missing",
  unknown: "unknown",
};

/** Migration drift classes folded to one posture tone (worst wins). */
function migrationTone(m: MigrationTargetV1): string {
  if (m.notAppliedCount > 0 || m.grantSurfaceViolations > 0) return statusColors.danger;
  if (m.unauditedBranchFiles > 0 || m.orphanTrackerRows > 0) return statusColors.revise;
  return statusColors.ship;
}

/**
 * Last-good is a FRESHNESS marker, not a severity: carried drift stays
 * danger/revise (CodeRabbit COS-11 — stale tone was masking carried drift);
 * only a carried CLEAN row renders the stale tone.
 */
function migrationRowTone(m: MigrationTargetV1): string {
  const tone = migrationTone(m);
  return m.lastGood && tone === statusColors.ship ? statusColors.stale : tone;
}

function migrationSummary(m: MigrationTargetV1): string {
  const drift: string[] = [];
  if (m.notAppliedCount > 0) drift.push(`${m.notAppliedCount} unapplied`);
  if (m.grantSurfaceViolations > 0) drift.push(`${m.grantSurfaceViolations} grant`);
  if (m.unauditedBranchFiles > 0) drift.push(`${m.unauditedBranchFiles} unaudited`);
  if (m.orphanTrackerRows > 0) drift.push(`${m.orphanTrackerRows} orphan`);
  return drift.length > 0 ? drift.join(" · ") : "clean";
}

function protectionTone(p: ProtectionRepoV1): string {
  // enforce_admins=true is the codified drift class (single-admin deadlock).
  if (p.enforceAdmins === true) return statusColors.danger;
  // Unreadable/absent field ≠ unverified desired state — distinct tones.
  if (p.enforceAdmins === null) return statusColors.reviewUnknown;
  if (p.verifiedAt === null) return statusColors.revise;
  return statusColors.ship;
}

/**
 * Connected masthead: quiet while LOADING/absent (the band never displaces the
 * board with a frame), but a fetch ERROR renders an explicit one-liner with
 * retry — an errored gates read must not look like "no gates" (silent-green).
 */
export function GatesBand({ companyId, now, isMobile }: { companyId: string | null; now: number; isMobile: boolean }) {
  const { gates, error, refresh } = useGatesState(companyId);
  if (!gates) {
    if (!error) return null;
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, color: tokens.muted }}>
        <span>gates state unreadable: {error.message}</span>
        <button
          type="button"
          onClick={refresh}
          style={{ background: "none", border: `1px solid ${tokens.border}`, borderRadius: 6, padding: "1px 8px", color: "inherit", font: "inherit", cursor: "pointer" }}
        >
          retry
        </button>
      </div>
    );
  }
  return <GatesBandView gates={gates} now={now} isMobile={isMobile} />;
}

/** Pure view — all display decisions from the projection, no fetching. */
export function GatesBandView({ gates, now, isMobile }: { gates: GatesStateV1; now: number; isMobile: boolean }) {
  const [open, setOpen] = useState(false);
  const drifted = gates.hooks.filter((h) => h.parity === "drifted" || h.parity === "missing");
  const unknownHooks = gates.hooks.filter((h) => h.parity === "unknown");
  // Worst wins; UNKNOWN parity is NOT green — "in sync" claims full evidence.
  const worstHooksTone =
    gates.hooks.length === 0
      ? statusColors.reviewUnknown
      : drifted.some((h) => h.parity === "missing")
        ? statusColors.danger
        : drifted.length > 0
          ? statusColors.revise
          : unknownHooks.length > 0
            ? statusColors.reviewUnknown
            : statusColors.ship;
  const hooksLabel =
    gates.hooks.length === 0
      ? "hooks: none read"
      : drifted.length > 0
        ? `hooks: ${drifted.length}/${gates.hooks.length} drifted`
        : unknownHooks.length > 0
          ? `hooks: ${unknownHooks.length}/${gates.hooks.length} unknown`
          : `hooks: ${gates.hooks.length} in sync`;
  const protDrift = gates.protection.filter((p) => p.enforceAdmins === true);

  return (
    <section
      aria-label="Gates & pipeline"
      style={{
        border: `1px solid ${tokens.border}`,
        borderRadius: 10,
        padding: isMobile ? "8px 10px" : "8px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        minWidth: 0,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          // Explicit resets, NOT `all: "unset"` — that nuked the native
          // :focus-visible outline (keyboard focus must stay visible).
          background: "none",
          border: "none",
          margin: 0,
          padding: 0,
          font: "inherit",
          color: "inherit",
          textAlign: "left",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          minWidth: 0,
          transition: springTransition,
        }}
        title="every gate in the ship pipeline, with its live posture — click to expand"
      >
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: tokens.muted }}>
          Gates
        </span>
        <Pill label={hooksLabel} tone={worstHooksTone} soft withDot />
        {gates.migrations.length === 0 ? (
          <Pill label="migrations: no audit on disk" tone={statusColors.reviewUnknown} soft />
        ) : (
          gates.migrations.map((m) => (
            <Pill
              key={m.target}
              label={`${m.target}: ${migrationSummary(m)}${m.lastGood ? " · last-good" : ""}`}
              tone={migrationRowTone(m)}
              soft
              withDot
              title={m.lastGood ? "no live audit row this derive — carried from the prior derive" : (m.ranAt ?? undefined)}
            />
          ))
        )}
        <Pill
          label={
            gates.protection.length === 0
              ? "protection: none codified"
              : protDrift.length > 0
                ? `protection: ${protDrift.length} drifted`
                : `protection: ${gates.protection.length} codified · never verified live`
          }
          tone={protDrift.length > 0 ? statusColors.danger : gates.protection.length === 0 ? statusColors.reviewUnknown : statusColors.revise}
          soft
          withDot
        />
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: tokens.muted }}>{open ? "collapse" : "expand"}</span>
      </button>

      {open ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
          <GatesGroup title="Hooks & pre-push gate">
            {gates.hooks.length === 0 ? (
              <MutedLine text="no repos read this derive" />
            ) : (
              gates.hooks.map((h) => <HooksRow key={h.repoKey} row={h} now={now} />)
            )}
            {gates.gateSuites.length > 0 ? (
              <MutedLine text={`gate suites: ${gates.gateSuites.join(", ")}`} />
            ) : (
              <MutedLine text="gate suites: roster unreadable" />
            )}
          </GatesGroup>

          <GatesGroup title="Migrations">
            {gates.migrations.length === 0 ? (
              <MutedLine text="no drift-audit JSON on disk (reports are machine-local) — absence is normal" />
            ) : (
              gates.migrations.map((m) => <MigrationRow key={m.target} row={m} now={now} />)
            )}
          </GatesGroup>

          <GatesGroup title="Branch protection (desired state)">
            {gates.protection.length === 0 ? (
              <MutedLine text="no branch-protection-as-code files found" />
            ) : (
              gates.protection.map((p) => <ProtectionRow key={p.repoName} row={p} />)
            )}
          </GatesGroup>

          <GatesGroup title="Dispatch ledgers">
            {gates.ledgers.length === 0 ? (
              <MutedLine text="no provenance ledgers on this machine — absence is normal" />
            ) : (
              gates.ledgers.map((l) => <LedgerRow key={l.ledger} row={l} now={now} />)
            )}
          </GatesGroup>
        </div>
      ) : null}
    </section>
  );
}

function GatesGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: tokens.muted }}>
        {title}
      </span>
      {children}
    </div>
  );
}

function MutedLine({ text }: { text: string }) {
  return <span style={{ fontSize: 11.5, color: tokens.muted }}>{text}</span>;
}

function HooksRow({ row, now }: { row: RepoHooksV1; now: number }) {
  const gateAge = row.lastGateRun ? relativeTime(row.lastGateRun.at, now) : null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minWidth: 0 }}>
      <span style={{ fontSize: 12, fontWeight: 600, minWidth: 84 }}>{row.repoKey}</span>
      <Pill label={PARITY_LABELS[row.parity]} tone={PARITY_TONES[row.parity]} soft withDot title="byte-diff of .githooks/* vs the canonical company set" />
      {row.driftedHooks.length > 0 ? (
        <span style={{ fontSize: 11, color: tokens.muted }}>drifted: {row.driftedHooks.join(", ")}</span>
      ) : null}
      {row.hooksPathValue ? (
        <span style={{ fontSize: 11, color: tokens.muted }} title="git config core.hooksPath">
          hooksPath {row.hooksPathValue}
        </span>
      ) : (
        <span style={{ fontSize: 11, color: tokens.muted }}>hooksPath unset</span>
      )}
      <span style={{ flex: 1 }} />
      {row.lastGateRun ? (
        <span style={{ fontSize: 11, color: tokens.muted, fontVariantNumeric: "tabular-nums" }} title={`run ${row.lastGateRun.runId}`}>
          last gate: {row.lastGateRun.verdict} @ {row.lastGateRun.sha8}
          {gateAge ? ` · ${gateAge}` : ""}
        </span>
      ) : (
        <span style={{ fontSize: 11, color: tokens.muted }}>no gate run recorded</span>
      )}
    </div>
  );
}

function MigrationRow({ row, now }: { row: MigrationTargetV1; now: number }) {
  const auditAge = row.auditMtime ? relativeTime(row.auditMtime, now) : null;
  const applyAge = row.lastApplyAt ? relativeTime(row.lastApplyAt, now) : null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minWidth: 0 }}>
      <span style={{ fontSize: 12, fontWeight: 600, minWidth: 84 }}>{row.target}</span>
      <Pill label={migrationSummary(row)} tone={migrationRowTone(row)} soft withDot />
      {row.lastGood ? (
        <Pill label="last-good" tone={statusColors.stale} title="no live audit row this derive — value carried from the prior derive" />
      ) : null}
      <span style={{ fontSize: 11, color: tokens.muted, fontVariantNumeric: "tabular-nums" }}>
        {row.totalEntries} audited · scanned {row.grantSurfaceScanned}
      </span>
      <span style={{ flex: 1 }} />
      {auditAge ? (
        <span style={{ fontSize: 11, color: tokens.muted }} title={row.auditRelPath}>
          audit {auditAge}
        </span>
      ) : null}
      {applyAge ? (
        <span style={{ fontSize: 11, color: tokens.muted }} title={row.lastApplyRelPath ?? undefined}>
          apply {applyAge}
        </span>
      ) : (
        <span style={{ fontSize: 11, color: tokens.muted }}>no apply receipt</span>
      )}
    </div>
  );
}

function ProtectionRow({ row }: { row: ProtectionRepoV1 }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minWidth: 0 }}>
      <span style={{ fontSize: 12, fontWeight: 600, minWidth: 84 }}>{row.repoName}</span>
      <Pill
        label={row.enforceAdmins === true ? "enforce_admins DRIFTED" : row.enforceAdmins === false ? "admin bypass (desired)" : "enforce_admins unknown"}
        tone={protectionTone(row)}
        soft
        withDot
        title="the codified single-admin posture is enforce_admins=false (2026-06-23 incident class)"
      />
      <span style={{ fontSize: 11, color: tokens.muted, fontVariantNumeric: "tabular-nums" }}>
        {row.requiredChecks.length} required checks · {row.requiredReviews ?? 0} review{(row.requiredReviews ?? 0) === 1 ? "" : "s"}
      </span>
      <span style={{ flex: 1 }} />
      {row.verifiedAt === null ? (
        <Pill label="never verified against live" tone={statusColors.revise} soft title="no assert-branch-protection receipt exists — desired state only, not silent-green" />
      ) : (
        <span style={{ fontSize: 11, color: tokens.muted }}>verified {row.verifiedAt}</span>
      )}
    </div>
  );
}

function LedgerRow({ row, now }: { row: LedgerV1; now: number }) {
  const rows = row.ledger === "cannons_runs" ? row.cannonsRuns.length : row.codexRows.length;
  const mtimeAge = row.logMtime ? relativeTime(row.logMtime, now) : null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minWidth: 0 }}>
      <span style={{ fontSize: 12, fontWeight: 600, minWidth: 84 }}>{row.ledger === "cannons_runs" ? "cannons" : "codex"}</span>
      <span style={{ fontSize: 11, color: tokens.muted, fontVariantNumeric: "tabular-nums" }}>
        {rows === 0 ? "no rows in window" : `${rows} rows`}
      </span>
      {row.truncated ? (
        <Pill
          label={`history truncated${row.logMtime ? ` at ${row.logMtime}` : ""}`}
          tone={statusColors.reviewUnknown}
          soft
          title="tail-window read — older history exists on disk but is outside the bounded window (normal)"
        />
      ) : null}
      <span style={{ flex: 1 }} />
      {mtimeAge ? <span style={{ fontSize: 11, color: tokens.muted }}>updated {mtimeAge}</span> : null}
    </div>
  );
}
