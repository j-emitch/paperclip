import { describe, expect, it } from "vitest";
import { deriveArtifactIndex } from "../../src/projections/deriveArtifactIndex.js";
import { parseArtifactIndexV1 } from "../../src/contracts/artifact-index.js";
import { NOW, artifact, bundleOf } from "../fixtures/signals.js";

describe("deriveArtifactIndex", () => {
  it("indexes entries, tallies countsByType, and validates", () => {
    const index = deriveArtifactIndex(
      bundleOf([
        artifact("specs/COS-0.md", { artifactType: "spec", system: "Company", prefix: "COS" }),
        artifact("specs/OB-01.md", { artifactType: "spec", prefix: "OB" }),
        artifact("reports/review-cannons/c.md", { artifactType: "cannons" }),
      ]),
      NOW,
    );
    expect(index.entries).toHaveLength(3);
    expect(index.countsByType).toEqual({ spec: 2, cannons: 1 });
    expect(() => parseArtifactIndexV1(index)).not.toThrow();
  });

  it("dedupes (repo, relPath) keeping the newest mtime", () => {
    const index = deriveArtifactIndex(
      bundleOf([
        artifact("specs/COS-0.md", { mtime: "2026-06-20T00:00:00.000Z", sha256: "old" }),
        artifact("specs/COS-0.md", { mtime: "2026-06-23T00:00:00.000Z", sha256: "new" }),
      ]),
      NOW,
    );
    expect(index.entries).toHaveLength(1);
    expect(index.entries[0].sha256).toBe("new");
  });

  it("countsByType is sparse — zero-count types are absent", () => {
    const index = deriveArtifactIndex(bundleOf([artifact("specs/x.md", { artifactType: "spec" })]), NOW);
    expect(index.countsByType.teaching).toBeUndefined();
    expect("knowledge" in index.countsByType).toBe(false);
  });
});
