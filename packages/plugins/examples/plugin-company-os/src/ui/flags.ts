/**
 * UI feature flags (COS-2f). Lives under `src/ui/` because only the browser bundle
 * reads it (via `app.tsx`) — the worker registers the `teaching-overview` handler
 * unconditionally; the flag only gates whether the UI shows the live tab. The
 * Teaching tab ships behind `COS_TEACHING_TAB_ENABLED` so it can land DARK: the
 * cockpit is byte-identical (the COS-0 placeholder) while it is off.
 *
 * The flag has two read surfaces, unified here:
 *   - UI bundle: esbuild `define` replaces `__COS_TEACHING_TAB_ENABLED__` with a
 *     STRING LITERAL at build time (there is no `process.env` in the browser), so
 *     the built bundle bakes in the on/off decision the operator built with.
 *   - Node/SSR (the render-slot build, the flag-off snapshot, vitest): the define
 *     isn't applied, so we fall back to the live `process.env` value.
 *
 * A value counts as ON only for the exact tokens `"1"` / `"true"` — an unset,
 * empty, or `"0"` value is OFF, so `COS_TEACHING_TAB_ENABLED=` reads as off.
 */

// Declared for tsc; esbuild `define` substitutes a string literal in the UI build.
// `typeof` on an undeclared global never throws, so the Node fallback path is safe.
declare const __COS_TEACHING_TAB_ENABLED__: string | undefined;

/** True only for the literal on-tokens; everything else (unset/empty/"0") is off. */
export function isFlagOn(raw: string | undefined | null): boolean {
  return raw === "1" || raw === "true";
}

/** Resolve the raw flag value from the build-time define, else the runtime env. */
export function teachingTabFlagValue(): string {
  const fromDefine = typeof __COS_TEACHING_TAB_ENABLED__ !== "undefined" ? __COS_TEACHING_TAB_ENABLED__ : undefined;
  if (fromDefine !== undefined) return fromDefine;
  if (typeof process !== "undefined" && process.env) return process.env.COS_TEACHING_TAB_ENABLED ?? "";
  return "";
}

/** Whether the COS-2f Teaching tab is live (else it renders the COS-0 placeholder). */
export function isTeachingTabEnabled(): boolean {
  return isFlagOn(teachingTabFlagValue());
}
