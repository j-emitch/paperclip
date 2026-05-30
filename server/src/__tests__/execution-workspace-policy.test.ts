import { describe, expect, it } from "vitest";
import {
  applyRealizedWorkspaceCwd,
  buildExecutionWorkspaceAdapterConfig,
  defaultIssueExecutionWorkspaceSettingsForProject,
  gateProjectExecutionWorkspacePolicy,
  HEARTBEAT_WORKTREE_BRANCH_TEMPLATE,
  issueExecutionWorkspaceModeForPersistedWorkspace,
  parseIssueExecutionWorkspaceSettings,
  parseProjectExecutionWorkspacePolicy,
  resolveExecutionWorkspaceMode,
  resolveHeartbeatWorktreeIsolation,
} from "../services/execution-workspace-policy.ts";

describe("execution workspace policy helpers", () => {
  it("defaults new issue settings from enabled project policy", () => {
    expect(
      defaultIssueExecutionWorkspaceSettingsForProject({
        enabled: true,
        defaultMode: "isolated_workspace",
      }),
    ).toEqual({ mode: "isolated_workspace" });
    expect(
      defaultIssueExecutionWorkspaceSettingsForProject({
        enabled: true,
        defaultMode: "shared_workspace",
      }),
    ).toEqual({ mode: "shared_workspace" });
    expect(defaultIssueExecutionWorkspaceSettingsForProject(null)).toBeNull();
  });

  it("prefers explicit issue mode over project policy and legacy overrides", () => {
    expect(
      resolveExecutionWorkspaceMode({
        projectPolicy: { enabled: true, defaultMode: "shared_workspace" },
        issueSettings: { mode: "isolated_workspace" },
        legacyUseProjectWorkspace: false,
      }),
    ).toBe("isolated_workspace");
  });

  it("falls back to project policy before legacy project-workspace compatibility flag", () => {
    expect(
      resolveExecutionWorkspaceMode({
        projectPolicy: { enabled: true, defaultMode: "isolated_workspace" },
        issueSettings: null,
        legacyUseProjectWorkspace: false,
      }),
    ).toBe("isolated_workspace");
    expect(
      resolveExecutionWorkspaceMode({
        projectPolicy: null,
        issueSettings: null,
        legacyUseProjectWorkspace: false,
      }),
    ).toBe("agent_default");
  });

  it("applies project policy strategy and runtime defaults when isolation is enabled", () => {
    const result = buildExecutionWorkspaceAdapterConfig({
      agentConfig: {
        workspaceStrategy: { type: "project_primary" },
      },
      projectPolicy: {
        enabled: true,
        defaultMode: "isolated_workspace",
        workspaceStrategy: {
          type: "git_worktree",
          baseRef: "origin/main",
          provisionCommand: "bash ./scripts/provision-worktree.sh",
        },
        workspaceRuntime: {
          services: [{ name: "web", command: "pnpm dev" }],
        },
      },
      issueSettings: null,
      mode: "isolated_workspace",
      legacyUseProjectWorkspace: null,
    });

    expect(result.workspaceStrategy).toEqual({
      type: "git_worktree",
      baseRef: "origin/main",
      provisionCommand: "bash ./scripts/provision-worktree.sh",
    });
    expect(result.workspaceRuntime).toEqual({
      services: [{ name: "web", command: "pnpm dev" }],
    });
  });

  it("clears managed workspace strategy when issue opts out to project primary or agent default", () => {
    const baseConfig = {
      workspaceStrategy: { type: "git_worktree", branchTemplate: "{{issue.identifier}}" },
      workspaceRuntime: { services: [{ name: "web" }] },
    };

    expect(
      buildExecutionWorkspaceAdapterConfig({
        agentConfig: baseConfig,
        projectPolicy: { enabled: true, defaultMode: "isolated_workspace" },
        issueSettings: { mode: "shared_workspace" },
        mode: "shared_workspace",
        legacyUseProjectWorkspace: null,
      }).workspaceStrategy,
    ).toBeUndefined();

    const agentDefault = buildExecutionWorkspaceAdapterConfig({
      agentConfig: baseConfig,
      projectPolicy: null,
      issueSettings: { mode: "agent_default" },
      mode: "agent_default",
      legacyUseProjectWorkspace: null,
    });
    expect(agentDefault.workspaceStrategy).toBeUndefined();
    expect(agentDefault.workspaceRuntime).toBeUndefined();
  });

  it("parses persisted JSON payloads into typed project and issue workspace settings", () => {
    expect(
      parseProjectExecutionWorkspacePolicy({
        enabled: true,
        defaultMode: "isolated",
        workspaceStrategy: {
          type: "git_worktree",
          worktreeParentDir: ".paperclip/worktrees",
          provisionCommand: "bash ./scripts/provision-worktree.sh",
          teardownCommand: "bash ./scripts/teardown-worktree.sh",
        },
      }),
    ).toEqual({
      enabled: true,
      defaultMode: "isolated_workspace",
      workspaceStrategy: {
        type: "git_worktree",
        worktreeParentDir: ".paperclip/worktrees",
        provisionCommand: "bash ./scripts/provision-worktree.sh",
        teardownCommand: "bash ./scripts/teardown-worktree.sh",
      },
    });
    expect(
      parseIssueExecutionWorkspaceSettings({
        mode: "project_primary",
      }),
    ).toEqual({
      mode: "shared_workspace",
    });
  });

  it("maps persisted execution workspace modes back to issue settings", () => {
    expect(issueExecutionWorkspaceModeForPersistedWorkspace("isolated_workspace")).toBe("isolated_workspace");
    expect(issueExecutionWorkspaceModeForPersistedWorkspace("operator_branch")).toBe("operator_branch");
    expect(issueExecutionWorkspaceModeForPersistedWorkspace("shared_workspace")).toBe("shared_workspace");
    expect(issueExecutionWorkspaceModeForPersistedWorkspace("adapter_managed")).toBe("agent_default");
    expect(issueExecutionWorkspaceModeForPersistedWorkspace("cloud_sandbox")).toBe("agent_default");
    expect(issueExecutionWorkspaceModeForPersistedWorkspace(null)).toBe("agent_default");
    expect(issueExecutionWorkspaceModeForPersistedWorkspace(undefined)).toBe("agent_default");
  });

  it("isolates a cwd-pinned heartbeat run into a git worktree", () => {
    const result = resolveHeartbeatWorktreeIsolation({
      adapterConfig: {
        command: "claude",
        cwd: "/Users/joe/projects/company",
      },
      resolvedWorkspaceSource: "agent_home",
      hasProjectWorkspace: false,
    });
    expect(result).not.toBeNull();
    expect(result?.baseCwd).toBe("/Users/joe/projects/company");
    expect(result?.config.workspaceStrategy).toEqual({
      type: "git_worktree",
      branchTemplate: HEARTBEAT_WORKTREE_BRANCH_TEMPLATE,
    });
    // Original config is preserved (no mutation, command intact).
    expect(result?.config.command).toBe("claude");
  });

  it("does not isolate when the run has no pinned cwd", () => {
    expect(
      resolveHeartbeatWorktreeIsolation({
        adapterConfig: { command: "claude" },
        resolvedWorkspaceSource: "agent_home",
        hasProjectWorkspace: false,
      }),
    ).toBeNull();
  });

  it("does not isolate when a managed project workspace already owns the cwd", () => {
    expect(
      resolveHeartbeatWorktreeIsolation({
        adapterConfig: { command: "claude", cwd: "/repo" },
        resolvedWorkspaceSource: "project_primary",
        hasProjectWorkspace: true,
      }),
    ).toBeNull();
    expect(
      resolveHeartbeatWorktreeIsolation({
        adapterConfig: { command: "claude", cwd: "/repo" },
        resolvedWorkspaceSource: "project_primary",
        hasProjectWorkspace: false,
      }),
    ).toBeNull();
  });

  it("respects an explicit git_worktree strategy already on the agent config", () => {
    expect(
      resolveHeartbeatWorktreeIsolation({
        adapterConfig: {
          command: "claude",
          cwd: "/repo",
          workspaceStrategy: { type: "git_worktree", branchTemplate: "custom/{{date}}" },
        },
        resolvedWorkspaceSource: "agent_home",
        hasProjectWorkspace: false,
      }),
    ).toBeNull();
  });

  it("preserves a non-worktree strategy's custom branch template when opting into worktrees", () => {
    const result = resolveHeartbeatWorktreeIsolation({
      adapterConfig: {
        command: "claude",
        cwd: "/repo",
        workspaceStrategy: { type: "project_primary", branchTemplate: "ops/{{agent.slug}}" },
      },
      resolvedWorkspaceSource: "agent_home",
      hasProjectWorkspace: false,
    });
    expect(result?.config.workspaceStrategy).toEqual({
      type: "git_worktree",
      branchTemplate: "ops/{{agent.slug}}",
    });
  });

  it("pushes the realized worktree cwd back into the adapter config", () => {
    expect(
      applyRealizedWorkspaceCwd({
        config: { command: "claude", cwd: "/repo" },
        workspaceStrategy: "git_worktree",
        workspaceCwd: "/repo/.paperclip/worktrees/heartbeat/librarian/2026-05-30",
      }),
    ).toEqual({
      command: "claude",
      cwd: "/repo/.paperclip/worktrees/heartbeat/librarian/2026-05-30",
    });
  });

  it("leaves the adapter config untouched for project_primary runs", () => {
    const config = { command: "claude", cwd: "/repo" };
    expect(
      applyRealizedWorkspaceCwd({
        config,
        workspaceStrategy: "project_primary",
        workspaceCwd: "/somewhere/else",
      }),
    ).toBe(config);
  });

  it("returns the same config object when the worktree cwd already matches", () => {
    const config = { command: "claude", cwd: "/repo/worktree" };
    expect(
      applyRealizedWorkspaceCwd({
        config,
        workspaceStrategy: "git_worktree",
        workspaceCwd: "/repo/worktree",
      }),
    ).toBe(config);
  });

  it("disables project execution workspace policy when the instance flag is off", () => {
    expect(
      gateProjectExecutionWorkspacePolicy(
        { enabled: true, defaultMode: "isolated_workspace" },
        false,
      ),
    ).toBeNull();
    expect(
      gateProjectExecutionWorkspacePolicy(
        { enabled: true, defaultMode: "isolated_workspace" },
        true,
      ),
    ).toEqual({ enabled: true, defaultMode: "isolated_workspace" });
  });
});
