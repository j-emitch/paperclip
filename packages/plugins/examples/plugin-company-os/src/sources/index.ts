/**
 * Source barrel — the ordered set of `WorkSignalSource`s the cockpit collects.
 * `DEFAULT_SOURCES` is the production roster; COS-1/COS-2 add teaching/knowledge
 * sources behind the extension seam without editing this list's existing
 * entries. Order is stable for deterministic bundle assembly + golden tests.
 */

import type { WorkSignalSource } from "../contracts/WorkSignalSource.js";
import { gitWorkSource } from "./GitWorkSource.js";
import { specBacklogSource } from "./SpecBacklogSource.js";
import { pullRequestSource } from "./PullRequestSource.js";
import { reviewReportSource } from "./ReviewReportSource.js";
import { routineContractSource } from "./RoutineContractSource.js";
import { artifactSource } from "./ArtifactSource.js";
import { prefixRegistrySource } from "./PrefixRegistrySource.js";

export const DEFAULT_SOURCES: readonly WorkSignalSource[] = [
  gitWorkSource,
  specBacklogSource,
  pullRequestSource,
  reviewReportSource,
  routineContractSource,
  artifactSource,
  prefixRegistrySource,
];

export * from "./GitWorkSource.js";
export * from "./SpecBacklogSource.js";
export * from "./PullRequestSource.js";
export * from "./ReviewReportSource.js";
export * from "./RoutineContractSource.js";
export * from "./ArtifactSource.js";
export * from "./PrefixRegistrySource.js";
// COS-2f teaching seam fill. Exported for the `teaching-overview` handler + tests,
// but INTENTIONALLY absent from DEFAULT_SOURCES: the Teaching tab is a live,
// file-backed read (no cached table), so the shared derive stays byte-identical.
export * from "./TeachingSource.js";
export * from "./parse.js";
