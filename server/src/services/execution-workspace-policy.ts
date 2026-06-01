import type {
  ExecutionWorkspaceMode,
  ExecutionWorkspaceStrategy,
  IssueExecutionWorkspaceSettings,
  ProjectExecutionWorkspaceDefaultMode,
  ProjectExecutionWorkspacePolicy,
} from "@paperclipai/shared";
import { asString, parseObject } from "../adapters/utils.js";

type ParsedExecutionWorkspaceMode = Exclude<ExecutionWorkspaceMode, "inherit" | "reuse_existing">;

function cloneRecord(value: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!value) return null;
  return { ...value };
}

function parseExecutionWorkspaceStrategy(raw: unknown): ExecutionWorkspaceStrategy | null {
  const parsed = parseObject(raw);
  const type = asString(parsed.type, "");
  if (type !== "project_primary" && type !== "git_worktree" && type !== "adapter_managed" && type !== "cloud_sandbox") {
    return null;
  }
  return {
    type,
    ...(typeof parsed.baseRef === "string" ? { baseRef: parsed.baseRef } : {}),
    ...(typeof parsed.branchTemplate === "string" ? { branchTemplate: parsed.branchTemplate } : {}),
    ...(typeof parsed.worktreeParentDir === "string" ? { worktreeParentDir: parsed.worktreeParentDir } : {}),
    ...(typeof parsed.provisionCommand === "string" ? { provisionCommand: parsed.provisionCommand } : {}),
    ...(typeof parsed.teardownCommand === "string" ? { teardownCommand: parsed.teardownCommand } : {}),
  };
}

export function parseProjectExecutionWorkspacePolicy(raw: unknown): ProjectExecutionWorkspacePolicy | null {
  const parsed = parseObject(raw);
  if (Object.keys(parsed).length === 0) return null;
  const enabled = typeof parsed.enabled === "boolean" ? parsed.enabled : false;
  const workspaceStrategy = parseExecutionWorkspaceStrategy(parsed.workspaceStrategy);
  const defaultMode = asString(parsed.defaultMode, "");
  const defaultProjectWorkspaceId =
    typeof parsed.defaultProjectWorkspaceId === "string" ? parsed.defaultProjectWorkspaceId : undefined;
  const environmentId = typeof parsed.environmentId === "string" ? parsed.environmentId : undefined;
  const allowIssueOverride =
    typeof parsed.allowIssueOverride === "boolean" ? parsed.allowIssueOverride : undefined;
  const normalizedDefaultMode = (() => {
    if (
      defaultMode === "shared_workspace" ||
      defaultMode === "isolated_workspace" ||
      defaultMode === "operator_branch" ||
      defaultMode === "adapter_default"
    ) {
      return defaultMode as ProjectExecutionWorkspaceDefaultMode;
    }
    if (defaultMode === "project_primary") return "shared_workspace";
    if (defaultMode === "isolated") return "isolated_workspace";
    return undefined;
  })();
  return {
    enabled,
    ...(normalizedDefaultMode ? { defaultMode: normalizedDefaultMode } : {}),
    ...(allowIssueOverride !== undefined ? { allowIssueOverride } : {}),
    ...(defaultProjectWorkspaceId ? { defaultProjectWorkspaceId } : {}),
    ...(environmentId !== undefined ? { environmentId } : {}),
    ...(workspaceStrategy ? { workspaceStrategy } : {}),
    ...(parsed.workspaceRuntime && typeof parsed.workspaceRuntime === "object" && !Array.isArray(parsed.workspaceRuntime)
      ? { workspaceRuntime: { ...(parsed.workspaceRuntime as Record<string, unknown>) } }
      : {}),
    ...(parsed.branchPolicy && typeof parsed.branchPolicy === "object" && !Array.isArray(parsed.branchPolicy)
      ? { branchPolicy: { ...(parsed.branchPolicy as Record<string, unknown>) } }
      : {}),
    ...(parsed.pullRequestPolicy && typeof parsed.pullRequestPolicy === "object" && !Array.isArray(parsed.pullRequestPolicy)
      ? { pullRequestPolicy: { ...(parsed.pullRequestPolicy as Record<string, unknown>) } }
      : {}),
    ...(parsed.runtimePolicy && typeof parsed.runtimePolicy === "object" && !Array.isArray(parsed.runtimePolicy)
      ? { runtimePolicy: { ...(parsed.runtimePolicy as Record<string, unknown>) } }
      : {}),
    ...(parsed.cleanupPolicy && typeof parsed.cleanupPolicy === "object" && !Array.isArray(parsed.cleanupPolicy)
      ? { cleanupPolicy: { ...(parsed.cleanupPolicy as Record<string, unknown>) } }
      : {}),
    ...(parsed.authorizationPolicy && typeof parsed.authorizationPolicy === "object" && !Array.isArray(parsed.authorizationPolicy)
      ? { authorizationPolicy: { ...(parsed.authorizationPolicy as Record<string, unknown>) } }
      : {}),
  };
}

export function gateProjectExecutionWorkspacePolicy(
  projectPolicy: ProjectExecutionWorkspacePolicy | null,
  isolatedWorkspacesEnabled: boolean,
): ProjectExecutionWorkspacePolicy | null {
  if (!isolatedWorkspacesEnabled) return null;
  return projectPolicy;
}

export function parseIssueExecutionWorkspaceSettings(raw: unknown): IssueExecutionWorkspaceSettings | null {
  const parsed = parseObject(raw);
  if (Object.keys(parsed).length === 0) return null;
  const workspaceStrategy = parseExecutionWorkspaceStrategy(parsed.workspaceStrategy);
  const mode = asString(parsed.mode, "");
  const normalizedMode = (() => {
    if (
      mode === "inherit" ||
      mode === "shared_workspace" ||
      mode === "isolated_workspace" ||
      mode === "operator_branch" ||
      mode === "reuse_existing" ||
      mode === "agent_default"
    ) {
      return mode;
    }
    if (mode === "project_primary") return "shared_workspace";
    if (mode === "isolated") return "isolated_workspace";
    return "";
  })();
  return {
    ...(normalizedMode
      ? { mode: normalizedMode as IssueExecutionWorkspaceSettings["mode"] }
      : {}),
    ...(typeof parsed.environmentId === "string" ? { environmentId: parsed.environmentId } : {}),
    ...(workspaceStrategy ? { workspaceStrategy } : {}),
    ...(parsed.workspaceRuntime && typeof parsed.workspaceRuntime === "object" && !Array.isArray(parsed.workspaceRuntime)
      ? { workspaceRuntime: { ...(parsed.workspaceRuntime as Record<string, unknown>) } }
      : {}),
  };
}

export type ExecutionWorkspaceEnvironmentSource =
  | "workspace"
  | "issue"
  | "project"
  | "agent"
  | "default";

export type ExecutionWorkspaceEnvironmentConflict = {
  reason: "reused_workspace_environment_mismatch";
  workspaceEnvironmentId: string;
  assigneeIntendedEnvironmentId: string;
  assigneeIntendedSource: Exclude<ExecutionWorkspaceEnvironmentSource, "workspace">;
};

export type ExecutionWorkspaceEnvironmentResolution = {
  environmentId: string;
  source: ExecutionWorkspaceEnvironmentSource;
  conflict: ExecutionWorkspaceEnvironmentConflict | null;
};

function resolveAssigneeIntendedExecutionWorkspaceEnvironment(input: {
  projectPolicy: ProjectExecutionWorkspacePolicy | null;
  issueSettings: IssueExecutionWorkspaceSettings | null;
  agentDefaultEnvironmentId: string | null;
  defaultEnvironmentId: string;
}): {
  environmentId: string;
  source: Exclude<ExecutionWorkspaceEnvironmentSource, "workspace">;
} {
  // Explicit issue-level env override always wins, even for null-default
  // (local-only) agents. An operator who deliberately set
  // `executionWorkspaceSettings.environmentId` on this specific issue (see the
  // issues-service contract preserved in issues.ts:4243) chose that env for
  // this assignment and should not be silently downgraded to the local default
  // (PAPA-430 review fix). Inherited issue envs from
  // `inheritExecutionWorkspaceFromIssueId` are stripped before this point in
  // `resolveExecutionWorkspaceEnvironmentId`.
  if (input.issueSettings?.environmentId !== undefined) {
    return {
      environmentId: input.issueSettings.environmentId ?? input.defaultEnvironmentId,
      source: "issue",
    };
  }
  // A null defaultEnvironmentId on the agent means it is deliberately scoped to
  // the local default (e.g. Manual QA today). Project policy must not promote
  // such an agent off of local — only an explicit issue-level override above
  // can move the assignee away from the local default.
  if (input.agentDefaultEnvironmentId === null) {
    return { environmentId: input.defaultEnvironmentId, source: "default" };
  }
  if (input.projectPolicy?.environmentId !== undefined) {
    return {
      environmentId: input.projectPolicy.environmentId ?? input.defaultEnvironmentId,
      source: "project",
    };
  }
  return { environmentId: input.agentDefaultEnvironmentId, source: "agent" };
}

export function resolveExecutionWorkspaceEnvironmentId(input: {
  projectPolicy: ProjectExecutionWorkspacePolicy | null;
  issueSettings: IssueExecutionWorkspaceSettings | null;
  workspaceConfig: { environmentId?: string | null } | null;
  agentDefaultEnvironmentId: string | null;
  defaultEnvironmentId: string;
}): ExecutionWorkspaceEnvironmentResolution {
  // PAPA-431 companion: when the assignee has no explicit defaultEnvironmentId
  // (deliberately local-only, e.g. Manual QA) AND the issue settings env exactly
  // matches the reused workspace env, treat the issue env as a promoted artifact
  // from `inheritExecutionWorkspaceFromIssueId` rather than a deliberate
  // operator choice. Strip it so the resolver falls back to the local default
  // and the workspace-vs-intended conflict check forces a fresh realization.
  // A genuine operator override (via PATCH on the issue) reaches this code path
  // either with no reused workspace (workspaceConfig === null) or against a
  // workspace whose persisted env does not match the new override; both keep
  // the issue setting in place.
  const inheritedIssueEnvOnNullDefaultAssignee =
    input.agentDefaultEnvironmentId === null &&
    input.workspaceConfig?.environmentId !== undefined &&
    input.workspaceConfig?.environmentId !== null &&
    input.issueSettings?.environmentId !== undefined &&
    input.issueSettings.environmentId === input.workspaceConfig.environmentId;
  let issueSettingsForResolution = input.issueSettings;
  if (inheritedIssueEnvOnNullDefaultAssignee && input.issueSettings) {
    const { environmentId: _droppedInheritedEnv, ...rest } = input.issueSettings;
    void _droppedInheritedEnv;
    issueSettingsForResolution = rest as IssueExecutionWorkspaceSettings;
  }

  const assigneeIntended = resolveAssigneeIntendedExecutionWorkspaceEnvironment({
    projectPolicy: input.projectPolicy,
    issueSettings: issueSettingsForResolution,
    agentDefaultEnvironmentId: input.agentDefaultEnvironmentId,
    defaultEnvironmentId: input.defaultEnvironmentId,
  });

  if (input.workspaceConfig?.environmentId !== undefined) {
    const workspaceEnvironmentId =
      input.workspaceConfig.environmentId ?? input.defaultEnvironmentId;
    // PAPA-380 / PAPA-431: a reused workspace's persisted environmentId must
    // never silently shadow the current assignee's environment identity.
    // When they disagree, refuse the silent reuse: return the assignee's
    // intended env and surface a conflict signal so the caller forces a fresh
    // workspace realization (or otherwise alerts the operator) instead of
    // running the agent on someone else's environment.
    if (workspaceEnvironmentId !== assigneeIntended.environmentId) {
      return {
        environmentId: assigneeIntended.environmentId,
        source: assigneeIntended.source,
        conflict: {
          reason: "reused_workspace_environment_mismatch",
          workspaceEnvironmentId,
          assigneeIntendedEnvironmentId: assigneeIntended.environmentId,
          assigneeIntendedSource: assigneeIntended.source,
        },
      };
    }
    return { environmentId: workspaceEnvironmentId, source: "workspace", conflict: null };
  }
  return { environmentId: assigneeIntended.environmentId, source: assigneeIntended.source, conflict: null };
}

export function defaultIssueExecutionWorkspaceSettingsForProject(
  projectPolicy: ProjectExecutionWorkspacePolicy | null,
): IssueExecutionWorkspaceSettings | null {
  if (!projectPolicy?.enabled) return null;
  return {
    mode:
      projectPolicy.defaultMode === "isolated_workspace"
        ? "isolated_workspace"
        : projectPolicy.defaultMode === "operator_branch"
          ? "operator_branch"
          : projectPolicy.defaultMode === "adapter_default"
            ? "agent_default"
            : "shared_workspace",
  };
}

export function issueExecutionWorkspaceModeForPersistedWorkspace(
  mode: string | null | undefined,
): IssueExecutionWorkspaceSettings["mode"] {
  if (mode === null || mode === undefined) {
    return "agent_default";
  }
  if (mode === "isolated_workspace" || mode === "operator_branch" || mode === "shared_workspace") {
    return mode;
  }
  if (mode === "adapter_managed" || mode === "cloud_sandbox") {
    return "agent_default";
  }
  return "shared_workspace";
}

export function resolveExecutionWorkspaceMode(input: {
  projectPolicy: ProjectExecutionWorkspacePolicy | null;
  issueSettings: IssueExecutionWorkspaceSettings | null;
  legacyUseProjectWorkspace: boolean | null;
}): ParsedExecutionWorkspaceMode {
  const issueMode = input.issueSettings?.mode;
  if (issueMode && issueMode !== "inherit" && issueMode !== "reuse_existing") {
    return issueMode;
  }
  if (input.projectPolicy?.enabled) {
    if (input.projectPolicy.defaultMode === "isolated_workspace") return "isolated_workspace";
    if (input.projectPolicy.defaultMode === "operator_branch") return "operator_branch";
    if (input.projectPolicy.defaultMode === "adapter_default") return "agent_default";
    return "shared_workspace";
  }
  if (input.legacyUseProjectWorkspace === false) {
    return "agent_default";
  }
  return "shared_workspace";
}

/**
 * Default branch template for cwd-pinned heartbeat agents that have no issue
 * context. Heartbeat agents (Librarian, CEO) run on a daily timer with no issue,
 * so the issue-identifier template would render empty. We key the branch off the
 * agent name + date instead so each run lands on its own short-lived branch.
 */
export const HEARTBEAT_WORKTREE_BRANCH_TEMPLATE = "heartbeat/{{agent.slug}}/{{date}}";

function configHasGitWorktreeStrategy(config: Record<string, unknown>): boolean {
  const strategy = parseExecutionWorkspaceStrategy(config.workspaceStrategy);
  return strategy?.type === "git_worktree";
}

/**
 * Decide whether a heartbeat run whose adapter config pins an explicit `cwd`
 * should be isolated into a per-run git worktree instead of executing directly
 * in that (shared) checkout.
 *
 * Background: heartbeat agents can hardwire `adapter_config.cwd` to a git
 * checkout (e.g. the Librarian pinned to `~/projects/company`). That cwd is read
 * verbatim by the process adapter, which BYPASSES the execution-workspace /
 * worktree-provisioning system entirely — the agent parks the shared checkout on
 * a branch and corrupts its git cache-tree across runs.
 *
 * When the conditions below hold we return a config that opts the run into the
 * existing `git_worktree` strategy (handled by `realizeExecutionWorkspace`) plus
 * the `baseCwd` to provision the worktree from. Returns `null` when isolation is
 * not applicable (no pinned cwd, an explicit strategy already set, or the run is
 * bound to a managed project workspace that already controls the cwd).
 */
export function resolveHeartbeatWorktreeIsolation(input: {
  adapterConfig: Record<string, unknown>;
  /** Source reported by `resolveWorkspaceForRun`. */
  resolvedWorkspaceSource: "project_primary" | "task_session" | "agent_home";
  /** True when a managed project workspace already provides the run cwd. */
  hasProjectWorkspace: boolean;
  branchTemplate?: string;
}): { baseCwd: string; config: Record<string, unknown> } | null {
  const pinnedCwd = asString(input.adapterConfig.cwd, "");
  if (!pinnedCwd) return null;
  // A project workspace (or its managed checkout) already owns the cwd and is
  // routed through the worktree machinery via `base.baseCwd`; don't double-pin.
  if (input.hasProjectWorkspace || input.resolvedWorkspaceSource === "project_primary") {
    return null;
  }
  // Respect an explicit worktree strategy already present on the agent config.
  if (configHasGitWorktreeStrategy(input.adapterConfig)) return null;

  const existingStrategy = parseObject(input.adapterConfig.workspaceStrategy);
  const nextStrategy: Record<string, unknown> = {
    ...existingStrategy,
    type: "git_worktree",
    branchTemplate:
      typeof existingStrategy.branchTemplate === "string" && existingStrategy.branchTemplate.length > 0
        ? existingStrategy.branchTemplate
        : (input.branchTemplate ?? HEARTBEAT_WORKTREE_BRANCH_TEMPLATE),
  };
  return {
    baseCwd: pinnedCwd,
    config: { ...input.adapterConfig, workspaceStrategy: nextStrategy },
  };
}

/**
 * Push the realized workspace cwd back into the adapter config so the adapter
 * process actually starts inside the provisioned worktree.
 *
 * The adapter reads `config.cwd` verbatim (see `adapters/process/execute.ts`),
 * but `realizeExecutionWorkspace` only returns the worktree path — it never
 * rewrites the config. Without this, a freshly provisioned worktree is ignored
 * and the adapter still runs in the original pinned cwd. Only applies for
 * git_worktree runs that resolved a concrete cwd.
 */
export function applyRealizedWorkspaceCwd(input: {
  config: Record<string, unknown>;
  workspaceStrategy: "project_primary" | "git_worktree";
  workspaceCwd: string;
}): Record<string, unknown> {
  if (input.workspaceStrategy !== "git_worktree") return input.config;
  const cwd = input.workspaceCwd.trim();
  if (!cwd) return input.config;
  if (asString(input.config.cwd, "") === cwd) return input.config;
  return { ...input.config, cwd };
}

/**
 * Pure decision for whether an isolated per-run heartbeat worktree is safe to
 * tear down after the run completes.
 *
 * Reaping a worktree runs `git worktree remove --force` + deletes its branch, so
 * we only do it once the work is provably recoverable from `origin`. Removal is
 * gated on BOTH:
 *   - a clean working tree (no uncommitted changes), and
 *   - zero local commits ahead of the resolved base branch on `origin`.
 *
 * If either fails (dirty tree OR unpushed commits) the worktree is preserved so
 * the agent's output is not silently destroyed; the caller logs a warning with
 * the path + branch so the work can be recovered by hand.
 */
export function decideHeartbeatWorktreeReap(input: {
  /** True when `git status --porcelain` produced no output. */
  clean: boolean;
  /** Count from `git rev-list origin/<base>..HEAD --count` (local commits not on origin). */
  aheadCount: number;
}): "reap" | "preserve" {
  if (!input.clean) return "preserve";
  if (input.aheadCount > 0) return "preserve";
  return "reap";
}

export function buildExecutionWorkspaceAdapterConfig(input: {
  agentConfig: Record<string, unknown>;
  projectPolicy: ProjectExecutionWorkspacePolicy | null;
  issueSettings: IssueExecutionWorkspaceSettings | null;
  mode: ParsedExecutionWorkspaceMode;
  legacyUseProjectWorkspace: boolean | null;
}): Record<string, unknown> {
  const nextConfig = { ...input.agentConfig };
  const projectHasPolicy = Boolean(input.projectPolicy?.enabled);
  const issueHasWorkspaceOverrides = Boolean(
    input.issueSettings?.mode ||
    input.issueSettings?.workspaceStrategy ||
    input.issueSettings?.workspaceRuntime,
  );
  const hasWorkspaceControl = projectHasPolicy || issueHasWorkspaceOverrides || input.legacyUseProjectWorkspace === false;

  if (hasWorkspaceControl) {
    if (input.mode === "isolated_workspace") {
      const strategy =
        input.issueSettings?.workspaceStrategy ??
        input.projectPolicy?.workspaceStrategy ??
        parseExecutionWorkspaceStrategy(nextConfig.workspaceStrategy) ??
        ({ type: "git_worktree" } satisfies ExecutionWorkspaceStrategy);
      nextConfig.workspaceStrategy = strategy;
    } else {
      delete nextConfig.workspaceStrategy;
    }

    if (input.mode === "agent_default") {
      delete nextConfig.workspaceRuntime;
    } else if (input.issueSettings?.workspaceRuntime) {
      nextConfig.workspaceRuntime = cloneRecord(input.issueSettings.workspaceRuntime) ?? undefined;
    } else if (input.projectPolicy?.workspaceRuntime) {
      nextConfig.workspaceRuntime = cloneRecord(input.projectPolicy.workspaceRuntime) ?? undefined;
    }
  }

  return nextConfig;
}
