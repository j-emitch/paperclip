import { describe, it, expect } from "vitest";
import { deriveLifecycle } from "../../src/projections/deriveLifecycle.js";
import { docSignal, work } from "../fixtures/signals.js";

const specDoc = (verified: boolean) => docSignal("specs/COS-1.md", { docType: "spec", prefix: "COS", verified });
const planDoc = (verified: boolean) =>
  docSignal("docs/superpowers/plans/COS-1-plan.md", { docType: "plan", prefix: "COS", verified });

describe("deriveLifecycle", () => {
  it("is all-todo with planState ok when nothing exists", () => {
    const lc = deriveLifecycle("COS", [], []);
    expect(lc).toEqual({ spec: "todo", plan: "todo", build: "todo", prod: "todo", planState: "ok" });
  });

  it("spec-only → Spec active, Plan warn (the plan gap), planState none", () => {
    const lc = deriveLifecycle("COS", [specDoc(false)], []);
    expect(lc.spec).toBe("active");
    expect(lc.plan).toBe("warn");
    expect(lc.planState).toBe("none");
    expect(lc.build).toBe("todo");
    expect(lc.prod).toBe("todo");
  });

  it("verified spec → Spec done", () => {
    const lc = deriveLifecycle("COS", [specDoc(true)], []);
    expect(lc.spec).toBe("done");
  });

  it("plan present but unverified → Plan active, planState authored", () => {
    const lc = deriveLifecycle("COS", [specDoc(true), planDoc(false)], []);
    expect(lc.plan).toBe("active");
    expect(lc.planState).toBe("authored");
  });

  it("verified plan → Plan done, planState approved", () => {
    const lc = deriveLifecycle("COS", [specDoc(true), planDoc(true)], []);
    expect(lc.plan).toBe("done");
    expect(lc.planState).toBe("approved");
  });

  it("in-progress work → Build active", () => {
    const lc = deriveLifecycle("COS", [specDoc(true)], [work("COS-1", "in_progress", "branch_path")]);
    expect(lc.build).toBe("active");
    expect(lc.prod).toBe("todo");
  });

  it("shipped work → Build done, Prod active (never auto-done, even below 100% built)", () => {
    // The cardinal AC: prod is decoupled from built-% — a family with a shipped
    // build AND an in-progress build is Prod active, NOT a contradictory 'done'.
    const lc = deriveLifecycle("COS", [specDoc(true)], [
      work("COS-1", "shipped", "commit_scope"),
      work("COS-2", "in_progress", "branch_path"),
    ]);
    expect(lc.build).toBe("done");
    expect(lc.prod).toBe("active");
    // No gate ever reads "done" for prod — prod is ongoing.
    expect(lc.prod).not.toBe("done");
  });

  it("plan present without a spec → Spec todo, Plan active, planState authored", () => {
    const lc = deriveLifecycle("COS", [planDoc(false)], []);
    expect(lc.spec).toBe("todo");
    expect(lc.plan).toBe("active");
    expect(lc.planState).toBe("authored");
  });
});
