/**
 * `deriveLifecycle` — pure fold of a family's spec/plan docs + work signals into
 * the Spec·Plan·Build·Prod lifecycle stepper. The cardinal rule (spec §5, PF-9):
 * the four gates are DECOUPLED from built-% — a rolling family can be `prod:
 * active` at 40% built without any contradiction, because the stepper reflects
 * lifecycle STAGE, not completion.
 *
 * Inputs are ONE family's spec/plan docs + its ALREADY-RESOLVED per-ticket work
 * states (the caller — `deriveBuildAtlas` — resolves reverts/newest-ship-wins in
 * `resolveBuilds` so a reverted-only ticket never reaches here as `shipped`).
 * That single resolution point guarantees the build fold and the lifecycle can
 * never contradict. Pure + unit-testable, no I/O.
 *   • Spec  — a spec doc exists → active; its `spec_verified` is set → done.
 *   • Plan  — a plan doc exists → active; its `plan_verified` is set → done;
 *             a spec with no plan → `warn` (the plan-gap).
 *   • Build — a shipped build present → done; in-progress/in-review → active.
 *   • Prod  — a shipped build present → active (prod is ongoing, never auto-"done").
 */

import type { DocSignal } from "../contracts/signals.js";
import type { WorkState } from "../contracts/vocab.js";
import type { LifecycleV1, PlanState } from "../contracts/build-atlas.js";

export function deriveLifecycle(
  _prefix: string,
  docs: readonly DocSignal[],
  ticketStates: readonly WorkState[],
): LifecycleV1 {
  const hasSpec = docs.some((d) => d.docType === "spec");
  const specVerified = docs.some((d) => d.docType === "spec" && d.verified);
  const hasPlan = docs.some((d) => d.docType === "plan");
  const planVerified = docs.some((d) => d.docType === "plan" && d.verified);

  const states = new Set(ticketStates);
  const hasShipped = states.has("shipped");
  const hasActive = states.has("in_progress") || states.has("in_review");

  const spec: LifecycleV1["spec"] = !hasSpec ? "todo" : specVerified ? "done" : "active";
  // A verified spec with no plan is a real gap → warn (not a neutral todo).
  const plan: LifecycleV1["plan"] = hasPlan
    ? planVerified
      ? "done"
      : "active"
    : hasSpec
      ? "warn"
      : "todo";
  const build: LifecycleV1["build"] = hasShipped ? "done" : hasActive ? "active" : "todo";
  // Prod is ongoing: shipped work means it is live/in-prod, but never auto-"done".
  const prod: LifecycleV1["prod"] = hasShipped ? "active" : "todo";

  return { spec, plan, build, prod, planState: planStateFor(hasSpec, hasPlan, planVerified) };
}

/**
 * Plan-coverage relative to the spec. `partial` (plan covers less than the spec's
 * ticket surface) needs ticket-level data and is resolved in 5c — 5a emits only
 * `none`/`authored`/`approved`/`ok`.
 */
function planStateFor(hasSpec: boolean, hasPlan: boolean, planVerified: boolean): PlanState {
  if (hasPlan) return planVerified ? "approved" : "authored";
  if (hasSpec) return "none"; // spec but no plan — the plan gap
  return "ok";
}
