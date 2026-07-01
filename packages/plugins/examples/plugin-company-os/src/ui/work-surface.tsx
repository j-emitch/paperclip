/**
 * `WorkSurface` — the cockpit's primary work surface selector. Renders the Build
 * Atlas (COS-5), or the retained Board when the `COS_ATLAS_FALLBACK` kill-switch
 * is engaged. The `atlas` tab mounts this; the fallback flag is injected as a prop
 * (defaulting to the module-level `COS_ATLAS_FALLBACK`) so the switch is
 * unit-testable both ways without stubbing build env — flag on → Board, flag off
 * → Atlas.
 */

import { Atlas } from "./atlas/Atlas.js";
import { CompanyOsBoard } from "./board/CompanyOsBoard.js";
import { COS_ATLAS_FALLBACK } from "./atlas-fallback.js";

export function WorkSurface({ companyId, fallback = COS_ATLAS_FALLBACK }: { companyId: string | null; fallback?: boolean }) {
  return fallback ? <CompanyOsBoard companyId={companyId} /> : <Atlas companyId={companyId} />;
}
