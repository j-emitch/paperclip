import { describe, expect, it } from "vitest";
import { normalizeProvenance } from "../../src/projections/provenance.js";

describe("normalizeProvenance", () => {
  it("normalizes real owner-agent created_by variants", () => {
    expect(normalizeProvenance("Librarian Agent")).toBe("Librarian");
    expect(normalizeProvenance("Librarian Agent (Paperclip)")).toBe("Librarian");
    expect(normalizeProvenance("librarian")).toBe("Librarian");
    expect(normalizeProvenance("librarian-agent")).toBe("Librarian");
    expect(normalizeProvenance("CTO")).toBe("CTO");
    expect(normalizeProvenance("cto agent (paperclip)")).toBe("CTO");
    expect(normalizeProvenance("COO")).toBe("COO");
    expect(normalizeProvenance("pm")).toBe("COO");
    expect(normalizeProvenance("CEO")).toBe("CEO");
  });

  it("rejects foreign slugs and non-owner personas", () => {
    expect(normalizeProvenance(null)).toBeNull();
    expect(normalizeProvenance("")).toBeNull();
    expect(normalizeProvenance("worktree-sweep")).toBeNull();
    expect(normalizeProvenance("context-freshness")).toBeNull();
    expect(normalizeProvenance("Researcher agent")).toBeNull();
    expect(normalizeProvenance("Claude (ops sweep)")).toBeNull();
    expect(normalizeProvenance("joe")).toBeNull();
  });
});
