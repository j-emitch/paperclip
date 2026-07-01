/**
 * `COS_ATLAS_FALLBACK` — the Build Atlas kill-switch (COS-5d-b).
 *
 * The Atlas replaces the Board as the cockpit's primary work surface, but the
 * Board's projection (`deriveBoardState`) + view (`CompanyOsBoardView`) stay on
 * disk precisely so this flag can restore it in one flip — no revert, no
 * redeploy of removed code. Flip this constant to `true` (a one-line config
 * commit) and `WorkSurface` renders the retained Board instead of the Atlas for
 * that release; flip back to re-engage the Atlas.
 *
 * It is a plain constant rather than a build-env read so it stays deterministic
 * under SSR + test (no `import.meta.env` to stub); `WorkSurface` takes the value
 * as an injectable prop so the switch is unit-testable both ways. Generalising
 * this into a broader cockpit feature-flag registry is a 5i cohesion candidate —
 * for one boolean, a documented constant is the honest surface.
 */
export const COS_ATLAS_FALLBACK = false;
