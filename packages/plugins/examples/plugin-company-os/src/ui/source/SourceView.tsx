/**
 * `SourceView` — the pure Source surface (spec §5.1/§5.7): the full per-branch
 * working-tree-vs-trunk audit, PROJECT-GROUPED via the shared `<ProjectSection>`
 * (non-compact — the audit keeps each family's context note). Each project lists
 * its member repos primary-first, INCLUDING configured-but-absent repos as honest
 * "not available" 0-rows (never vanished); each available repo lists its branches
 * (most-recently-active first) as expandable `BranchRow`s. No SDK runtime — the
 * connected `Source` injects data, so this renders identically under SSR (the
 * Playwright harness) and live.
 */

import type { GitStateV1, ProjectGitSectionV1, RepoGitStateV1 } from "../../contracts/index.js";
import { statusColors, tokens } from "../tokens.js";
import { Dot, Pill, RepoBadge } from "../shared/badges.js";
import { CalmNote } from "../shared/feedback.js";
import { CockpitSurfaceStyles } from "../shared/surface-styles.js";
import { CockpitMotionStyles } from "../shared/cockpit-motion.js";
import { ProjectSection } from "../shared/ProjectSection.js";
import { StaleSourcePills } from "../shared/freshness.js";
import { ClockIcon } from "../icons.js";
import { relativeTime, safeTime } from "../shared/time.js";
import { REPO_AVAILABILITY_LABELS, REPO_AVAILABILITY_TONES } from "../shared/git-labels.js";
import { BranchRow } from "./BranchRow.js";

export interface SourceViewProps {
  gitState: GitStateV1;
  now: number;
  isMobile?: boolean;
  /** A `branchExpandKey(repoKey, branch)` to auto-expand (a consumed deep-link). */
  expandKey?: string | null;
}

/** The stable key used to match a deep-link's target branch to its row. */
export function branchExpandKey(repoKey: string, branch: string | null): string {
  return `${repoKey}::${branch ?? "_detached"}`;
}

function branchCount(section: ProjectGitSectionV1): number {
  return section.repos.reduce((sum, r) => sum + r.branches.length, 0);
}

export function SourceView({ gitState, now, isMobile = false, expandKey = null }: SourceViewProps) {
  const derivedAge = relativeTime(gitState.derivedAt, now);
  const hasAnyRepo = gitState.groups.some((g) => g.repos.length > 0);

  return (
    <div role="tabpanel" aria-label="Source" style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
      <CockpitSurfaceStyles />
      <CockpitMotionStyles />

      <header style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 650, color: tokens.fg }}>Source</h2>
        {derivedAge ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: tokens.muted }}>
            <span aria-hidden="true" style={{ display: "inline-flex" }}>
              <ClockIcon size={12} />
            </span>
            as of {derivedAge}
          </span>
        ) : null}
        <StaleSourcePills sources={gitState.sources} />
      </header>

      {!hasAnyRepo ? (
        <CalmNote>No repositories are configured yet — add roots to <code style={{ fontFamily: tokens.mono }}>repoRoots</code> and they appear here on the next derive.</CalmNote>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          {gitState.groups.map((section, i) => (
            <div key={section.group.key} className="cos-fx-enter" style={{ animationDelay: `${i * 70}ms` }}>
              <ProjectSection group={section.group} count={branchCount(section)}>
                {section.repos.length === 0 ? (
                  <CalmNote>No repositories in this project.</CalmNote>
                ) : (
                  section.repos.map((repo) => (
                    <RepoSection
                      key={repo.repoKey}
                      repo={repo}
                      isDisplayPrimary={section.displayPrimaryRepoKey === repo.repoKey}
                      now={now}
                      isMobile={isMobile}
                      expandKey={expandKey}
                    />
                  ))
                )}
              </ProjectSection>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RepoSection({
  repo,
  isDisplayPrimary,
  now,
  isMobile,
  expandKey,
}: {
  repo: RepoGitStateV1;
  isDisplayPrimary: boolean;
  now: number;
  isMobile: boolean;
  expandKey: string | null;
}) {
  const available = repo.availability === "ok";
  // Most-recently-active branches first; unknown/unparseable tip dates sort last.
  const branches = [...repo.branches].sort((a, b) => safeTime(b.lastCommitAt) - safeTime(a.lastCommitAt));

  return (
    <section aria-label={repo.repoKey} style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minWidth: 0 }}>
        <RepoBadge repo={repo.repoKey} />
        {repo.role === "dependency" ? <Pill label="dependency" tone={tokens.muted} /> : null}
        {isDisplayPrimary ? <Pill label="acting primary" tone={statusColors.cached} title="the configured primary repo is absent on disk; this dependency is shown as the project's primary" /> : null}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: REPO_AVAILABILITY_TONES[repo.availability] }}>
          <Dot tone={REPO_AVAILABILITY_TONES[repo.availability]} size={6} />
          {REPO_AVAILABILITY_LABELS[repo.availability]}
        </span>
        {available && repo.trunk.ref ? (
          <span style={{ fontSize: 11, color: tokens.muted, fontFamily: tokens.mono }} title="trunk this repo's branches compare against">
            trunk: {repo.trunk.ref}
          </span>
        ) : null}
        {available && repo.trunk.state === "missing" ? (
          <span style={{ fontSize: 11, color: statusColors.cached }}>no trunk resolved</span>
        ) : null}
      </div>

      {!available ? (
        <CalmNote>This repo is configured but {REPO_AVAILABILITY_LABELS[repo.availability]} — nothing to show until it&rsquo;s present.</CalmNote>
      ) : branches.length === 0 ? (
        <CalmNote tone={statusColors.ship}>No branches — clean working copy.</CalmNote>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {branches.map((branch) => (
            <BranchRow
              key={branch.branch ?? `_detached:${branch.headSha}`}
              branch={branch}
              now={now}
              isMobile={isMobile}
              defaultExpanded={expandKey === branchExpandKey(repo.repoKey, branch.branch)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
