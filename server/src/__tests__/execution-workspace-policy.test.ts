import { describe, expect, it } from "vitest";
import {
  applyRealizedWorkspaceCwd,
  buildExecutionWorkspaceAdapterConfig,
  decideHeartbeatWorktreeReap,
  defaultIssueExecutionWorkspaceSettingsForProject,
  gateProjectExecutionWorkspacePolicy,
  HEARTBEAT_WORKTREE_BRANCH_TEMPLATE,
  issueExecutionWorkspaceModeForPersistedWorkspace,
  parseIssueExecutionWorkspaceSettings,
  parseProjectExecutionWorkspacePolicy,
  resolveExecutionWorkspaceEnvironmentId,
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

  it("preserves project authorization policy for trust-preset resolution", () => {
    expect(parseProjectExecutionWorkspacePolicy({
      enabled: true,
      authorizationPolicy: {
        trustBoundary: {
          mode: "low_trust_review",
          projectIds: ["33333333-3333-4333-8333-333333333333"],
        },
      },
    })?.authorizationPolicy).toEqual({
      trustBoundary: {
        mode: "low_trust_review",
        projectIds: ["33333333-3333-4333-8333-333333333333"],
      },
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
        environmentId: "8f8ab8f2-d95f-4315-9f08-d683a1e0f73b",
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
      environmentId: "8f8ab8f2-d95f-4315-9f08-d683a1e0f73b",
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
        environmentId: "8f8ab8f2-d95f-4315-9f08-d683a1e0f73b",
      }),
    ).toEqual({
      mode: "shared_workspace",
      environmentId: "8f8ab8f2-d95f-4315-9f08-d683a1e0f73b",
    });
  });

  it("reuses persisted workspace environment when it agrees with the assignee's identity", () => {
    expect(
      resolveExecutionWorkspaceEnvironmentId({
        projectPolicy: { enabled: true, environmentId: "agent-env" },
        issueSettings: { environmentId: "agent-env" },
        workspaceConfig: { environmentId: "agent-env" },
        agentDefaultEnvironmentId: "agent-env",
        defaultEnvironmentId: "default-env",
      }),
    ).toEqual({
      environmentId: "agent-env",
      source: "workspace",
      conflict: null,
    });
  });

  it("refuses silent reuse when the persisted workspace env disagrees with the assignee (PAPA-380: sandbox agent on local workspace)", () => {
    // Claude E2B was assigned to a child issue whose parent had already
    // realized a `Local` workspace. The persisted workspace env must not
    // shadow the agent's intended sandbox env.
    expect(
      resolveExecutionWorkspaceEnvironmentId({
        projectPolicy: { enabled: true, environmentId: null },
        issueSettings: { environmentId: "sandbox-env", mode: "shared_workspace" },
        workspaceConfig: { environmentId: "local-env" },
        agentDefaultEnvironmentId: "sandbox-env",
        defaultEnvironmentId: "local-env",
      }),
    ).toEqual({
      environmentId: "sandbox-env",
      source: "issue",
      conflict: {
        reason: "reused_workspace_environment_mismatch",
        workspaceEnvironmentId: "local-env",
        assigneeIntendedEnvironmentId: "sandbox-env",
        assigneeIntendedSource: "issue",
      },
    });
  });

  it("refuses silent reuse when a null-default (local) agent inherits a non-local workspace env (PAPA-431: Manual QA on engineer SSH workspace)", () => {
    // Manual QA agent has defaultEnvironmentId: null. When a sibling issue's
    // SSH workspace is inherited via inheritExecutionWorkspaceFromIssueId,
    // the persisted SSH env must NOT shadow the agent's deliberate local
    // identity. The inherited issueSettings.environmentId is treated as a
    // promoted artifact, not an explicit operator choice.
    expect(
      resolveExecutionWorkspaceEnvironmentId({
        projectPolicy: { enabled: true, environmentId: null },
        issueSettings: { environmentId: "ssh-env", mode: "isolated_workspace" },
        workspaceConfig: { environmentId: "ssh-env" },
        agentDefaultEnvironmentId: null,
        defaultEnvironmentId: "local-env",
      }),
    ).toEqual({
      environmentId: "local-env",
      source: "default",
      conflict: {
        reason: "reused_workspace_environment_mismatch",
        workspaceEnvironmentId: "ssh-env",
        assigneeIntendedEnvironmentId: "local-env",
        assigneeIntendedSource: "default",
      },
    });
  });

  it("honors an explicit issue env override for null-default agents when no workspace is being reused", () => {
    // Operator explicitly chose an env on this issue via PATCH (see the
    // issues-service contract at issues-service.test.ts:1924). For null-default
    // agents, this is a deliberate choice — only inherited issue env (which
    // matches a reused workspace env) should be discarded.
    expect(
      resolveExecutionWorkspaceEnvironmentId({
        projectPolicy: { enabled: true, environmentId: "project-env" },
        issueSettings: { environmentId: "issue-env" },
        workspaceConfig: null,
        agentDefaultEnvironmentId: null,
        defaultEnvironmentId: "local-env",
      }),
    ).toEqual({
      environmentId: "issue-env",
      source: "issue",
      conflict: null,
    });
  });

  it("honors an explicit issue env override for null-default agents even against a disagreeing reused workspace", () => {
    // Operator picked sandbox-env explicitly while the previously-realized
    // workspace was on local-env. The mismatch is genuine — surface a conflict
    // so the heartbeat forces a fresh realization on the operator's chosen env.
    expect(
      resolveExecutionWorkspaceEnvironmentId({
        projectPolicy: { enabled: true, environmentId: null },
        issueSettings: { environmentId: "sandbox-env", mode: "shared_workspace" },
        workspaceConfig: { environmentId: "local-env" },
        agentDefaultEnvironmentId: null,
        defaultEnvironmentId: "local-env",
      }),
    ).toEqual({
      environmentId: "sandbox-env",
      source: "issue",
      conflict: {
        reason: "reused_workspace_environment_mismatch",
        workspaceEnvironmentId: "local-env",
        assigneeIntendedEnvironmentId: "sandbox-env",
        assigneeIntendedSource: "issue",
      },
    });
  });

  it("prefers the explicit issue environment over project and agent defaults when no workspace is reused", () => {
    expect(
      resolveExecutionWorkspaceEnvironmentId({
        projectPolicy: { enabled: true, environmentId: "project-env" },
        issueSettings: { environmentId: "issue-env" },
        workspaceConfig: null,
        agentDefaultEnvironmentId: "agent-env",
        defaultEnvironmentId: "default-env",
      }),
    ).toEqual({
      environmentId: "issue-env",
      source: "issue",
      conflict: null,
    });
    expect(
      resolveExecutionWorkspaceEnvironmentId({
        projectPolicy: { enabled: true, environmentId: "project-env" },
        issueSettings: null,
        workspaceConfig: null,
        agentDefaultEnvironmentId: "agent-env",
        defaultEnvironmentId: "default-env",
      }),
    ).toEqual({
      environmentId: "project-env",
      source: "project",
      conflict: null,
    });
  });

  it("falls back to the agent default environment before the company default", () => {
    expect(
      resolveExecutionWorkspaceEnvironmentId({
        projectPolicy: null,
        issueSettings: null,
        workspaceConfig: null,
        agentDefaultEnvironmentId: "agent-env",
        defaultEnvironmentId: "default-env",
      }),
    ).toEqual({
      environmentId: "agent-env",
      source: "agent",
      conflict: null,
    });
    expect(
      resolveExecutionWorkspaceEnvironmentId({
        projectPolicy: { enabled: true, environmentId: null },
        issueSettings: null,
        workspaceConfig: null,
        agentDefaultEnvironmentId: "agent-env",
        defaultEnvironmentId: "default-env",
      }),
    ).toEqual({
      environmentId: "default-env",
      source: "project",
      conflict: null,
    });
    expect(
      resolveExecutionWorkspaceEnvironmentId({
        projectPolicy: null,
        issueSettings: null,
        workspaceConfig: null,
        agentDefaultEnvironmentId: null,
        defaultEnvironmentId: "default-env",
      }),
    ).toEqual({
      environmentId: "default-env",
      source: "default",
      conflict: null,
    });
    expect(
      resolveExecutionWorkspaceEnvironmentId({
        projectPolicy: { enabled: true, environmentId: null },
        issueSettings: null,
        workspaceConfig: null,
        agentDefaultEnvironmentId: null,
        defaultEnvironmentId: "default-env",
      }),
    ).toEqual({
      environmentId: "default-env",
      source: "default",
      conflict: null,
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

describe("decideHeartbeatWorktreeReap", () => {
  it("reaps a clean, fully-pushed worktree", () => {
    expect(decideHeartbeatWorktreeReap({ clean: true, aheadCount: 0 })).toBe("reap");
  });

  it("preserves a dirty worktree (uncommitted changes)", () => {
    expect(decideHeartbeatWorktreeReap({ clean: false, aheadCount: 0 })).toBe("preserve");
  });

  it("preserves a clean worktree with unpushed local commits", () => {
    expect(decideHeartbeatWorktreeReap({ clean: true, aheadCount: 1 })).toBe("preserve");
  });

  it("preserves when both dirty and ahead", () => {
    expect(decideHeartbeatWorktreeReap({ clean: false, aheadCount: 3 })).toBe("preserve");
  });
});
