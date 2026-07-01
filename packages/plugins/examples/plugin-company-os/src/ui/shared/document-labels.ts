/**
 * Human labels for the artifact/document types, shared by the document viewer's
 * type pill + the Reports artifact browser. Contract TYPE-only import (SSR-safe).
 */

import type { ArtifactType } from "../../contracts/index.js";

export const ARTIFACT_TYPE_LABELS: Record<ArtifactType, string> = {
  spec: "Specs",
  handoff: "Handoffs",
  cannons: "Reviews",
  routine_output: "Routine output",
  teaching: "Teaching",
  knowledge: "Knowledge",
};
