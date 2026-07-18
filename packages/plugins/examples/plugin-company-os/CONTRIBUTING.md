# Contributing to the CompanyOS cockpit — local-to-main

CompanyOS (this plugin) is a **solo, internal surface** — the owner's developer
cockpit. To hold it to the same code **and** UI standard as the other products
**without** burning GitHub Actions minutes on every change, it uses a
**local-to-main** flow: quality is gated **locally** by
[`scripts/companyos-local-ci.sh`](../../../../scripts/companyos-local-ci.sh), and
every change still ships as a **numbered PR + admin-merge to `lycaon`** (the branch
the live cockpit runs from). The PR is the durable tracking record; the admin-merge
spends zero Actions. Modelled on juice-bar's `scripts/local-ci.sh` local-to-main
fallback.

## The flow

1. **Branch off `lycaon`** — never edit `lycaon` directly:
   `git switch -c companyos/<slug> lycaon`.
2. Make the change.
3. **Gate locally:** `scripts/companyos-local-ci.sh` (add `--full` for a broad or
   cross-package change). Must exit 0.
4. **UI-touching? Add the visual evidence.** Run the visual-excellence three-way
   browser verify (desktop + mobile + reduced-motion) against the live cockpit and
   attach the screenshots to the PR (see [UI quality bar](#ui-quality-bar) below).
5. **Numbered PR to `lycaon`:** `git push -u origin HEAD` then
   `gh pr create --base lycaon --fill`.
6. **Admin-merge (zero Actions):** `gh pr merge --admin --squash`.
7. **Activate:** rebuild the plugin **and** restart the server — a source merge
   alone changes nothing live (see [Activation gotcha](#activation-gotcha)):
   ```bash
   pnpm --filter @paperclipai/plugin-company-os build
   launchctl kickstart -k gui/$(id -u)/com.lycaon.paperclip-server
   ```

## What the local gate covers (parity)

`companyos-local-ci.sh` mirrors the **code** gates `pr.yml` enforces, scoped to the
plugin so the loop is fast:

| Gate | What it catches |
|---|---|
| `check:tokens` | machine-specific / home paths leaking into tracked files |
| `check-no-git-push` | forbidden `git push` in adapter/runtime code |
| typecheck (plugin) | type regressions (strict, zero `as any`) |
| tests (plugin, vitest) | behavior regressions across the surface |
| build (plugin, esbuild) | the artifact the cockpit actually loads compiles |
| `--full` (opt-in) | workspace `typecheck:build-gaps` + full vitest run |

**Not covered — use the normal PR + CI path for these:**

- `pr.yml`'s `policy` job — lockfile integrity, `release-package-map check`,
  `check-docker-deps-stage`. Runs on **every** PR in CI, and matters when a change
  touches `package.json` / dependencies. The local gate does **not** reproduce it.
- release-time jobs: `e2e.yml`, `docker.yml`, `release.yml` / release-smoke.

The `check:tokens` step above is an **extra** local guard (a pre-publish check), not
itself a `pr.yml` gate — it's here because a leaked home path is exactly the kind of
thing a solo local-to-main flow should catch. CompanyOS changes are plugin-internal
UI / logic and don't need the policy or release jobs per-PR; if you touch deps or
release wiring, take that change through PR + CI instead.

## UI quality bar

Every UI-touching CompanyOS change clears the **visual-excellence gate** before
merge:

- **Browser-verified three ways** — desktop + mobile + reduced-motion, with
  screenshot evidence on the PR.
- **Premium mechanics** — spring physics, micro-interactions, and thoughtful
  empty / loading / error states (show 0 counts, never hide empty states).
- **Intentional motion only** — every animation maps to a real signal via the
  shared `cos-fx-*` vocabulary in `src/ui/shared/cockpit-motion.tsx`; all of it is
  suppressed under `prefers-reduced-motion`, so that viewport is genuinely still.
  No decorative / ambient motion.
- **A11y floor** — keyboard nav + visible focus, `prefers-reduced-motion` honored,
  touch targets >= 44px.

## Activation gotcha

The cockpit loads the plugin from its **built `dist/`** (esbuild) and its data
surfaces read the **company MAIN checkout** working tree. Two consequences:

1. **A merged source change is invisible until you rebuild + restart.** `dev:once`
   does not rebuild this example plugin on its own — run the build, then
   `launchctl kickstart` the server. The board re-derives on its 5-minute schedule
   after the restart.
2. **Never park the company checkout on a feature branch.** The cockpit renders
   whatever is checked out at `~/projects/company`; a stale or diverged checkout
   silently feeds the cockpit stale data.
