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
import { agentSource } from "./AgentSource.js";
import { artifactSource } from "./ArtifactSource.js";
import { prefixRegistrySource } from "./PrefixRegistrySource.js";
import { branchSource } from "./BranchSource.js";
import { docsSource } from "./DocsSource.js";
import { skillsSource } from "./SkillsSource.js";
import { lineageSource } from "./LineageSource.js";
import { paperclipTicketSource } from "./PaperclipTicketSource.js";
import { worktreeSource } from "./WorktreeSource.js";
import { hooksSource } from "./HooksSource.js";
import { migrationAuditSource } from "./MigrationAuditSource.js";
import { dispatchLedgerSource } from "./DispatchLedgerSource.js";
import { protectionSource } from "./ProtectionSource.js";

export const DEFAULT_SOURCES: readonly WorkSignalSource[] = [
  gitWorkSource,
  specBacklogSource,
  pullRequestSource,
  reviewReportSource,
  routineContractSource,
  agentSource,
  artifactSource,
  prefixRegistrySource,
  // COS-1 daily-driver sources (additive — appended so existing order is stable).
  branchSource,
  docsSource,
  // COS-1h skills catalog (additive — appended last).
  skillsSource,
  // COS-5 build-atlas lineage graph (additive — appended last).
  lineageSource,
  // COS-5c Paperclip LYC ticket bridge (additive — appended last).
  paperclipTicketSource,
  // COS-8c worktree lifecycle (additive — appended last).
  worktreeSource,
  // COS-11 gates & pipeline (additive — appended last; distinct kinds, PF-2 inert).
  hooksSource,
  migrationAuditSource,
  dispatchLedgerSource,
  protectionSource,
];

export * from "./GitWorkSource.js";
export * from "./WorktreeSource.js";
export * from "./SpecBacklogSource.js";
export * from "./PullRequestSource.js";
export * from "./ReviewReportSource.js";
export * from "./RoutineContractSource.js";
export * from "./AgentSource.js";
export * from "./ArtifactSource.js";
export * from "./PrefixRegistrySource.js";
export * from "./BranchSource.js";
export * from "./DocsSource.js";
export * from "./SkillsSource.js";
export * from "./LineageSource.js";
export * from "./PaperclipTicketSource.js";
// COS-2f teaching seam fill. Exported for the `teaching-overview` handler + tests,
// but INTENTIONALLY absent from DEFAULT_SOURCES: the Teaching tab is a live,
// file-backed read (no cached table), so the shared derive stays byte-identical.
export * from "./TeachingSource.js";
export * from "./parse.js";
// COS-11 gates & pipeline sources.
export * from "./HooksSource.js";
export * from "./MigrationAuditSource.js";
export * from "./DispatchLedgerSource.js";
export * from "./ProtectionSource.js";
