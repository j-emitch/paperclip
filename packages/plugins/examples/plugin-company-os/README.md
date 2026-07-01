# Company OS (`lycaon.company-os`)

The owner/developer **dev cockpit** for Lycaon: an auto-updating Kanban
(system × spec-prefix family, self-moving chips) plus Home, Source, Docs, and
Agents surfaces over the multi-repo workspace (juice-bar, arc-scraper, company,
paperclip). Read-only over the product repos; the only writes are the
plugin-owned `company_os` Postgres namespace (cache + diagnostics), plugin
state, and an opt-in, reversible, disabled-by-default git hook.

> Lives under `examples/` for the auto SDK-link + simplest local dev. The
> `example` tag is cosmetic — discovery, install, and function are identical to
> a first-party plugin. Graduation path: `packages/plugins/plugin-company-os`.

## Architecture (one signal layer)

```
sources/*  (WorkSignalSource: the only place that knows git/gh/fs/AGENTS)
   ↓ normalize
signals    (typed)
   ↓ collectAndProject(input)   ← pure, no ctx
projections: deriveBoardState · deriveArtifactIndex · deriveRoutineHealth
   ↓
UI (consumes projections only — import-boundary enforced)
```

The scheduled `derive-board` job (and the thin-trigger git hook in COS-0g) call
the **pure** `collectAndProject` and write the result to the `company_os` cache
under an atomic CAS lock. COS-1 (teaching) and COS-2 (knowledge) attach as new
`WorkSignalSource`s + projections — no rewrite.

## Build phases

| Phase | What |
|-------|------|
| COS-0a | Plugin scaffold (this commit): manifest, worker bridge, tabbed UI shell |
| COS-0b | Contracts + prefix registry + agent fenced-blocks |
| COS-0c | Source collectors (git / specs / PRs / reports / routines) |
| COS-0d | Pure projections + `company_os` DB cache + atomic lock + worker data/action API |
| COS-0e | Kanban UI |
| COS-0f | Docs/Reports + Routines viewer |
| COS-0g | Scheduled job + thin-trigger git hook + kill-switch |
| COS-0h | Registry reconcile + agent-directive finalize + lifecycle |

## DB namespace

`plugin_company_os_cc959257d2` (= `derivePluginDatabaseNamespace("lycaon.company-os","company_os")`).
Uninstall does **not** drop the namespace — rollback is a manual operator step:

```bash
psql "$PAPERCLIP_DB" -c 'DROP SCHEMA plugin_company_os_cc959257d2 CASCADE'
```

## Build / test

```bash
pnpm --filter @paperclipai/plugin-company-os build      # -> dist/{manifest,worker,ui}
pnpm --filter @paperclipai/plugin-company-os typecheck
pnpm --filter @paperclipai/plugin-company-os test
```

See the spec + plan in the `company` repo (`docs/COS-0`) for the full design.
