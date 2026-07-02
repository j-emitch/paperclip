import esbuild from "esbuild";
import { createPluginBundlerPresets } from "@paperclipai/plugin-sdk/bundlers";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const presets = createPluginBundlerPresets({ uiEntry: "src/ui/index.tsx" });
const watch = process.argv.includes("--watch");

// COS-2f: bake the Teaching-tab flag into the UI bundle. There is no `process.env`
// in the browser, so `__COS_TEACHING_TAB_ENABLED__` is substituted at build time
// (see src/flags.ts). Default (unset) → the tab ships DARK / byte-identical.
presets.esbuild.ui.define = {
  ...(presets.esbuild.ui.define ?? {}),
  __COS_TEACHING_TAB_ENABLED__: JSON.stringify(process.env.COS_TEACHING_TAB_ENABLED ?? ""),
};

const workerCtx = await esbuild.context(presets.esbuild.worker);
const manifestCtx = await esbuild.context(presets.esbuild.manifest);
const uiCtx = await esbuild.context(presets.esbuild.ui);

if (watch) {
  await Promise.all([workerCtx.watch(), manifestCtx.watch(), uiCtx.watch()]);
  console.log("esbuild watch mode enabled for worker, manifest, and ui");
} else {
  await Promise.all([workerCtx.rebuild(), manifestCtx.rebuild(), uiCtx.rebuild()]);
  await Promise.all([workerCtx.dispose(), manifestCtx.dispose(), uiCtx.dispose()]);
  await emitTeachingFlagOffSnapshot();
}

/**
 * COS-2f flag-off byte-identity artifact. Bundle the tab-slot renderer to a
 * standalone Node CJS module (react + react-dom/server + zod inlined so it runs
 * with plain `node`; CJS format because those deps use runtime `require`, which
 * an ESM bundle can't shim), then render the FLAG-OFF slot and write it to
 * `dist/.teaching-flagoff-snapshot`. The verify diffs a fresh `render-tab-slot.mjs`
 * (flag off) against this — byte-identical proves the tab is dormant when off.
 */
async function emitTeachingFlagOffSnapshot() {
  const cjsUrl = new URL("./dist/render-slot.cjs", import.meta.url);
  await esbuild.build({
    entryPoints: ["src/render-slot.tsx"],
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node20",
    jsx: "automatic",
    outfile: fileURLToPath(cjsUrl),
    logLevel: "warning",
  });
  const require = createRequire(import.meta.url);
  const { renderTeachingTabSlot } = require(fileURLToPath(cjsUrl));
  const snapshotUrl = new URL("./dist/.teaching-flagoff-snapshot", import.meta.url);
  await writeFile(snapshotUrl, renderTeachingTabSlot(false), "utf8");
  console.log("COS-2f: wrote dist/render-slot.cjs + dist/.teaching-flagoff-snapshot");
}
