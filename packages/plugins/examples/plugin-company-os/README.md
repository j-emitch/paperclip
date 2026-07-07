# Company OS (`lycaon.company-os`)

The owner/developer **dev cockpit** for Lycaon — Joe's primary daily-driver surface over the
multi-repo workspace (juice-bar, arc-scraper, company, paperclip, viacava-arts). Read-only over
the product repos; the only writes are the plugin-owned Postgres namespace (cache +
diagnostics), plugin state, and an opt-in, reversible git hook.

> **📖 The canonical living doc is `company/docs/company-os/16-cockpit-plugin.md`** — live
> deployment state, the machine-checked subsystem registry (`cos-registry` fenced block,
> gated by `company/scripts/audit-cos-registry.sh`), operational runbook, and known-issue
> ledger all live THERE, not here. This README is a code-local pointer + build notes only.
> If you change `src/sources/index.ts`, `src/projections/`, `src/ui/tabs.ts`, `migrations/`,
> or `src/manifest.ts`, update that doc's registry block in the same change.

> Lives under `examples/` for the auto SDK-link + simplest local dev. The `example` tag is
> cosmetic — discovery, install, and function are identical to a first-party plugin.
> Graduation path: `packages/plugins/plugin-company-os`.

## Architecture (one signal layer)

```
sources/*  (WorkSignalSource: the only place that knows git/gh/fs/AGENTS)
   ↓ normalize
signals    (typed)
   ↓ collectAndProject(input)   ← pure, no ctx
projections (derive*.ts)
   ↓
UI (consumes projections only — import-boundary enforced)
```

The scheduled `derive-board` job (`*/5`) and the thin-trigger git hook (COS-0g,
`scripts/README.md`) call the **pure** `collectAndProject` and write to the namespace cache
under an atomic CAS lock. New capability = new source + new projection (+ tab/lane),
additive `schemaVersion` bumps — never mutate existing sources.

## What shipped when

COS-0 spine + Home/Docs/Agents + hooks · COS-1/1R orientation + agent cohesion · COS-2
Teaching/Knowledge/Hygiene + corpus pipeline · COS-5 Atlas + Branch·PR Health + GH_TOKEN
passthrough. Current tabs: Home · Atlas · Branch·PR Health · Docs · Agents · Skills ·
Teaching · Knowledge · Hygiene. Roadmap (COS-7/8/9/10, COS-6 last):
`company/docs/audits/2026-07-06-workflow-audit.md` §11.

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

Specs + plans live in the `company` repo (`docs/superpowers/specs/2026-0*-COS-*.md`).
