import { describe, expect, it } from "vitest";
import {
  extractCompanyOsYaml,
  extractContextInProgress,
  extractShipped,
  extractTicketIds,
  normalizeVerdict,
  parseBranch,
  parseCommitScope,
  parseCompanyOsBlock,
  parseFrontmatter,
  parseGhPrList,
  parseGitLogRecords,
  parseMergeBranch,
  parseReviewReport,
  parseRevert,
  parseTrailers,
  parseWorktreeList,
  prefixOf,
  reportKindFromPath,
  stripScalarComment,
  ticketFromFilename,
} from "../../src/sources/parse.js";
import { globRootDirs, globToRegExp, matchesAnyGlob } from "../../src/sources/glob.js";

describe("ticket grammar", () => {
  it("extracts prefix+num+optional single suffix", () => {
    expect(extractTicketIds("feat(COS-0a): x")).toEqual(["COS-0a"]);
    expect(extractTicketIds("COS-0 and GON-04b and LYC-434")).toEqual(["COS-0", "GON-04b", "LYC-434"]);
  });
  it("rejects two-letter suffixes and single-letter prefixes", () => {
    expect(extractTicketIds("GON-04bc")).toEqual([]);
    expect(extractTicketIds("A-1")).toEqual([]);
  });
  it("does not swallow a trailing -y", () => {
    expect(extractTicketIds("COS-0-y")).toEqual(["COS-0"]);
  });
  it("dedupes, order-preserving", () => {
    expect(extractTicketIds("COS-0 COS-0 OB-01")).toEqual(["COS-0", "OB-01"]);
  });
  it("prefixOf", () => {
    expect(prefixOf("COS-0b")).toBe("COS");
    expect(prefixOf("nope")).toBeNull();
  });
});

describe("branch precedence (rung 1)", () => {
  it.each([
    ["claude/COS-0/design", ["COS-0"]],
    ["feat/COS-0-y", ["COS-0"]],
    ["docs/COS-0", ["COS-0"]],
    ["fix/COS-0-z", ["COS-0"]],
    ["claude/OB-08+OB-09+OB-10/T2-flesh", ["OB-08", "OB-09", "OB-10"]],
  ])("%s → %j", (branch, ids) => {
    const p = parseBranch(branch);
    expect(p.ticketIds).toEqual(ids);
    expect(p.reason).toBeUndefined();
  });
  it("random branch → bad_branch_format", () => {
    const p = parseBranch("random");
    expect(p.ticketIds).toEqual([]);
    expect(p.reason).toBe("bad_branch_format");
    expect(p.isBaseBranch).toBe(false);
  });
  it("main/master/HEAD are base branches (ignored, not unclassified)", () => {
    for (const b of ["main", "master", "HEAD"]) {
      const p = parseBranch(b);
      expect(p.isBaseBranch).toBe(true);
      expect(p.reason).toBeUndefined();
    }
  });
});

describe("commit scope + trailers (rungs 3)", () => {
  it("parses single + multi-ticket scope", () => {
    expect(parseCommitScope("feat(COS-0a): x")).toEqual(["COS-0a"]);
    expect(parseCommitScope("fix(GAP-00, GAP-01): y")).toEqual(["GAP-00", "GAP-01"]);
    expect(parseCommitScope("chore: no scope")).toEqual([]);
  });
  it("ignores free-text outside the scope", () => {
    expect(parseCommitScope("feat(COS-0a): bumped to UTF-8 mode")).toEqual(["COS-0a"]);
  });
  it("parses Ticket/Refs trailers", () => {
    expect(parseTrailers("body\n\nTicket: COS-0a\nRefs: OB-01, OB-02")).toEqual(["COS-0a", "OB-01", "OB-02"]);
  });
});

describe("revert + shipped extraction", () => {
  it("merge/squash subject scope (multi-ticket fanout)", () => {
    expect(extractShipped({ subject: "feat(SSF-02): spine (#310)", body: "" })).toEqual([
      { ticketId: "SSF-02", via: "scope", reverted: false },
    ]);
    expect(extractShipped({ subject: "fix(GAP-00, GAP-01): dedupe", body: "" }).map((t) => t.ticketId)).toEqual([
      "GAP-00",
      "GAP-01",
    ]);
  });
  it("trailer fallback when subject has no scope", () => {
    expect(extractShipped({ subject: "Merge pull request #5", body: "Ticket: COS-0c" })).toEqual([
      { ticketId: "COS-0c", via: "trailer", reverted: false },
    ]);
  });
  it("branch fallback only when nothing else classifies", () => {
    expect(
      extractShipped({ subject: "Merge pull request #5 from x/feat/OB-01-foo", body: "", branch: "feat/OB-01-foo" }),
    ).toEqual([{ ticketId: "OB-01", via: "branch", reverted: false }]);
  });
  it("revert un-ships (reverted: true) and short-circuits", () => {
    const r = parseRevert('Revert "feat(COS-0a): scaffold"');
    expect(r.isRevert).toBe(true);
    expect(r.revertedTicketIds).toEqual(["COS-0a"]);
    expect(extractShipped({ subject: 'Revert "feat(COS-0a): scaffold"', body: "" })).toEqual([
      { ticketId: "COS-0a", via: "revert", reverted: true },
    ]);
  });

  it("merge-commit subjects carry the branch for the fallback (no explicit branch field)", () => {
    expect(parseMergeBranch("Merge pull request #5 from j-emitch/feat/OB-01-foo")).toBe("feat/OB-01-foo");
    expect(parseMergeBranch("Merge branch 'fix/GAP-00-x' into main")).toBe("fix/GAP-00-x");
    expect(parseMergeBranch("feat(COS-0a): not a merge")).toBeNull();
    expect(extractShipped({ subject: "Merge pull request #5 from org/feat/OB-01-foo", body: "" })).toEqual([
      { ticketId: "OB-01", via: "branch", reverted: false },
    ]);
  });
});

describe("frontmatter", () => {
  it("parses scalar keys, strips quotes + comments", () => {
    const fm = parseFrontmatter(`---\ntype: spec\nstatus: "approved"  # note\nid: COS-0\n---\nbody`);
    expect(fm).toEqual({ type: "spec", status: "approved", id: "COS-0" });
  });
  it("returns null without a block; ignores nested/list lines", () => {
    expect(parseFrontmatter("no frontmatter")).toBeNull();
    const fm = parseFrontmatter(`---\nkey: v\nnested:\n  - a\n  - b\n---\n`);
    expect(fm).toEqual({ key: "v", nested: "" });
  });
  it("strips comments quote-aware (a # inside a quoted value survives)", () => {
    expect(stripScalarComment("ship  # the verdict")).toBe("ship");
    expect(stripScalarComment('"Phase #1"  # note')).toBe('"Phase #1"');
    const fm = parseFrontmatter(`---\ntitle: "Phase #1"\nstatus: planned # wip\n---\n`);
    expect(fm).toEqual({ title: "Phase #1", status: "planned" });
  });
});

describe("company_os fenced block", () => {
  const md = [
    "preamble",
    "```yaml",
    "company_os:",
    "  routines:",
    "    - id: daily-standup",
    "      display_name: Daily Standup",
    "      cadence: daily",
    "      expected_artifact: company/reports/standup/*.md",
    "      owner_agent: CTO",
    "    - id: weekly-report",
    "      display_name: Weekly Report",
    "      cadence: weekly",
    "      expected_artifact: company/reports/weekly/*.md",
    "      owner_agent: CTO",
    "```",
  ].join("\n");

  it("extracts the company_os yaml block (real root key)", () => {
    const y = extractCompanyOsYaml(md);
    expect(y).not.toBeNull();
    expect(y).toMatch(/^company_os:/);
  });
  it("parses both routines with all fields", () => {
    const block = parseCompanyOsBlock(extractCompanyOsYaml(md)!);
    expect(block.errors).toEqual([]);
    expect(block.routines).toHaveLength(2);
    expect(block.routines[0]).toEqual({
      id: "daily-standup",
      display_name: "Daily Standup",
      cadence: "daily",
      expected_artifact: "company/reports/standup/*.md",
      owner_agent: "CTO",
    });
  });
  it("tolerates an optional write_authority sibling key (PWA forward-compat)", () => {
    const withWa = md.replace("  routines:", "  write_authority:\n    tier: 1\n  routines:");
    const block = parseCompanyOsBlock(extractCompanyOsYaml(withWa)!);
    expect(block.hasWriteAuthority).toBe(true);
    expect(block.routines).toHaveLength(2);
  });
  it("records an error for a routine missing a field", () => {
    const bad = md.replace("      owner_agent: CTO\n    - id: weekly-report", "    - id: weekly-report");
    const block = parseCompanyOsBlock(extractCompanyOsYaml(bad)!);
    expect(block.errors.some((e) => /missing/.test(e))).toBe(true);
  });
});

describe("review report frontmatter", () => {
  it("parses a cannons report header", () => {
    const fm = parseFrontmatter(
      `---\ntype: cannons-report\nrepo: juice-bar\ncommit: 2722251b1347ad0ba0cd638226ec4c01b3d95f77\nverdict: ship\np0_count: 0\np1_count: 1\np2_count: 2\nrun_at: 2026-04-17T03:13:58Z\n---\n`,
    )!;
    const r = parseReviewReport(fm);
    expect(r).toMatchObject({
      repo: "juice-bar",
      fullSha: "2722251b1347ad0ba0cd638226ec4c01b3d95f77",
      verdict: "ship",
      generatedAt: "2026-04-17T03:13:58Z",
      p0: 0,
      p1: 1,
      p2: 2,
      prNumber: null,
    });
  });
  it("normalizes verdict variants", () => {
    expect(normalizeVerdict("**ship**")).toBe("ship");
    expect(normalizeVerdict("proceed-with-mitigation")).toBe("proceed");
    expect(normalizeVerdict("garbage")).toBe("unknown");
    expect(normalizeVerdict(undefined)).toBe("unknown");
  });
  it("classifies report kind by path", () => {
    expect(reportKindFromPath("reports/review-cannons/x.md")).toBe("cannons");
    expect(reportKindFromPath("reports/reviews/x.md")).toBe("review");
  });
});

describe("git output parsers", () => {
  it("parses worktree porcelain (branch, detached)", () => {
    const out = parseWorktreeList(
      "worktree /a/main\nHEAD aaa\nbranch refs/heads/main\n\nworktree /a/wt\nHEAD bbb\nbranch refs/heads/claude/COS-0\n\nworktree /a/det\nHEAD ccc\ndetached\n",
    );
    expect(out).toEqual([
      { path: "/a/main", head: "aaa", branch: "main", detached: false },
      { path: "/a/wt", head: "bbb", branch: "claude/COS-0", detached: false },
      { path: "/a/det", head: "ccc", branch: null, detached: true },
    ]);
  });
  it("parses log records (sha · committer-date · subject · body; RS/US separated, multi-line bodies)", () => {
    const recs = parseGitLogRecords(
      `abc\x1f2026-05-01T00:00:00Z\x1ffeat(COS-0a): x\x1fbody line1\nline2\x1e` + `def\x1f2026-05-02T00:00:00Z\x1ffix(OB-01): y\x1f\x1e`,
    );
    expect(recs).toEqual([
      { sha: "abc", committedAt: "2026-05-01T00:00:00Z", subject: "feat(COS-0a): x", body: "body line1\nline2" },
      { sha: "def", committedAt: "2026-05-02T00:00:00Z", subject: "fix(OB-01): y", body: "" },
    ]);
  });
});

describe("gh pr list JSON", () => {
  it("parses + coerces a PR array", () => {
    const { prs, ok } = parseGhPrList(
      JSON.stringify([
        { number: 5, title: "feat(COS-0c): x", headRefName: "cos/COS-0", headRefOid: "deadbeef", url: "u", isDraft: false, updatedAt: "t" },
      ]),
    );
    expect(ok).toBe(true);
    expect(prs[0]).toMatchObject({ number: 5, title: "feat(COS-0c): x", headRefOid: "deadbeef" });
  });
  it("ok:false on non-JSON / non-array", () => {
    expect(parseGhPrList("not json").ok).toBe(false);
    expect(parseGhPrList('{"x":1}').ok).toBe(false);
  });
});

describe("misc parsers", () => {
  it("ticketFromFilename", () => {
    expect(ticketFromFilename("docs/2026-06-23-COS-0-plan.md")).toBe("COS-0");
    expect(ticketFromFilename("notes.md")).toBeNull();
  });
  it("extractContextInProgress reads under the heading only", () => {
    const md = `## What's In Progress\n- OB-11 finishing\n- GAP-00 ghost\n\n## Recent Decisions\n- SSF-02 shipped\n`;
    expect(extractContextInProgress(md)).toEqual(["OB-11", "GAP-00"]);
  });
  it("extractContextInProgress tolerates a curly apostrophe", () => {
    const md = `## What’s In Progress\n- COS-0 cockpit\n`;
    expect(extractContextInProgress(md)).toEqual(["COS-0"]);
  });
});

describe("glob matcher", () => {
  it("matches ** across segments and * within one", () => {
    expect(matchesAnyGlob("specs/a/b/x.md", ["specs/**/*.md"])).toBe(true);
    expect(matchesAnyGlob("specs/x.md", ["specs/**/*.md"])).toBe(true);
    expect(matchesAnyGlob("CONTEXT.md", ["CONTEXT.md"])).toBe(true);
    expect(matchesAnyGlob("specs/x.txt", ["specs/**/*.md"])).toBe(false);
    expect(matchesAnyGlob("other/x.md", ["specs/**/*.md"])).toBe(false);
  });
  it("escapes regex metachars in literals", () => {
    expect(globToRegExp("a.b").test("axb")).toBe(false);
    expect(globToRegExp("a.b").test("a.b")).toBe(true);
  });
  it("globRootDirs extracts literal roots and flags wildcard roots", () => {
    expect(globRootDirs(["specs/**/*.md", "reports/reviews/*.md", "CONTEXT.md"])).toEqual(
      new Set(["specs", "reports", "CONTEXT.md"]),
    );
    expect(globRootDirs(["**/*.md"]).has("*")).toBe(true);
  });
});
