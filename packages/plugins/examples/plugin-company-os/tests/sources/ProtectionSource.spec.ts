import { describe, expect, it } from "vitest";
import { protectionSource, parseProtectionConfig, parseProtectionManifest } from "../../src/sources/ProtectionSource.js";
import { isProtectionSignal, type ProtectionSignal } from "../../src/contracts/signals.js";
import { makeFixtureContext } from "../fixtures/context.js";

/** Ground-truthed shapes (company config/branch-protection/, verified 2026-07-09). */
const MANIFEST = JSON.stringify({
  _comment: ["source of truth"],
  repos: {
    "juice-bar": { slug: "j-emitch/JuiceBar", branch: "main", config: "juice-bar.json" },
    company: { slug: "j-emitch/company", branch: "main", config: "company.json" },
  },
});

const JB_CONFIG = JSON.stringify({
  required_status_checks: {
    strict: true,
    checks: [
      { context: "API (lint + test + build + tsc)", app_id: 15368 },
      { context: "Apply new migrations to staging", app_id: 15368 },
    ],
  },
  enforce_admins: false,
  required_pull_request_reviews: { require_code_owner_reviews: true, required_approving_review_count: 1 },
  restrictions: null,
});

const COMPANY_CONFIG = JSON.stringify({
  required_status_checks: null,
  enforce_admins: false,
  required_pull_request_reviews: { required_approving_review_count: 1 },
});

describe("ProtectionSource", () => {
  it("emits one signal per manifest entry with the gate-relevant fields; verifiedAt is ALWAYS null (no receipt exists)", async () => {
    const ctx = makeFixtureContext({
      repos: [{ repo: "company", available: true }],
      files: {
        company: {
          "config/branch-protection/repos.json": { content: MANIFEST },
          "config/branch-protection/juice-bar.json": { content: JB_CONFIG },
          "config/branch-protection/company.json": { content: COMPANY_CONFIG },
        },
      },
    });
    const batch = await protectionSource.collect(ctx);
    const sigs = batch.signals.filter(isProtectionSignal) as ProtectionSignal[];
    expect(sigs.map((s) => s.repoName).sort()).toEqual(["company", "juice-bar"]);
    const jb = sigs.find((s) => s.repoName === "juice-bar")!;
    expect(jb.slug).toBe("j-emitch/JuiceBar");
    expect(jb.branch).toBe("main");
    expect(jb.enforceAdmins).toBe(false);
    expect(jb.requiredChecks).toEqual(["API (lint + test + build + tsc)", "Apply new migrations to staging"]);
    expect(jb.requiredReviews).toBe(1);
    expect(jb.verifiedAt).toBeNull();
    const co = sigs.find((s) => s.repoName === "company")!;
    expect(co.requiredChecks).toEqual([]);
    expect(batch.repoFreshness[0]?.freshness).toBe("live");
  });

  it("one unreadable config degrades but the other repos' signals survive", async () => {
    const ctx = makeFixtureContext({
      repos: [{ repo: "company", available: true }],
      files: {
        company: {
          "config/branch-protection/repos.json": { content: MANIFEST },
          "config/branch-protection/juice-bar.json": { content: JB_CONFIG },
          // company.json missing entirely
        },
      },
    });
    const batch = await protectionSource.collect(ctx);
    const sigs = batch.signals.filter(isProtectionSignal);
    expect(sigs.map((s) => s.repoName)).toEqual(["juice-bar"]);
    expect(batch.repoFreshness[0]?.freshness).toBe("stale");
  });

  it("an unparseable manifest stales company and emits nothing", async () => {
    const ctx = makeFixtureContext({
      repos: [{ repo: "company", available: true }],
      files: { company: { "config/branch-protection/repos.json": { content: "{broken" } } },
    });
    const batch = await protectionSource.collect(ctx);
    expect(batch.signals).toHaveLength(0);
    expect(batch.repoFreshness[0]?.freshness).toBe("stale");
    expect(batch.repoFreshness[0]?.errors[0]?.code).toBe("parse_error");
  });

  it("emits nothing on a scoped refresh that doesn't touch company", async () => {
    const ctx = makeFixtureContext({
      repos: [
        { repo: "company", available: true },
        { repo: "juice-bar", available: true },
      ],
      scopeRepo: "juice-bar",
    });
    const batch = await protectionSource.collect(ctx);
    expect(batch.signals).toHaveLength(0);
    expect(batch.repoFreshness).toHaveLength(0);
  });

  it("parsers: manifest rejects malformed entries; config lifts checks/admins/reviews and nulls absences", () => {
    expect(parseProtectionManifest('{"repos":{"x":{"slug":"a/b"}}}')).toBeNull();
    expect(parseProtectionManifest("junk")).toBeNull();
    const parsed = parseProtectionConfig('{"enforce_admins":true}');
    expect(parsed).toEqual({ enforceAdmins: true, requiredChecks: [], requiredReviews: null });
    expect(parseProtectionConfig("junk")).toBeNull();
  });
});
