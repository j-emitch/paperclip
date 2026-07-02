/**
 * `useTeaching` — the Teaching tab's data seam (COS-2f). Reads the worker's LIVE,
 * file-backed `teaching-overview` handler (validated `TeachingOverviewV1`). The
 * corpus is workspace-wide, so `companyId` is passed only for the SDK's cache key,
 * not because the read is company-scoped. Type-only contract import keeps the
 * browser bundle zod-free.
 */

import { usePluginData } from "@paperclipai/plugin-sdk/ui";
import type { PluginBridgeError } from "@paperclipai/plugin-sdk/ui";
import type { TeachingOverviewV1 } from "../../contracts/index.js";

export interface UseTeachingResult {
  overview: TeachingOverviewV1 | null;
  loading: boolean;
  error: PluginBridgeError | null;
  refresh: () => void;
}

export function useTeaching(companyId: string | null): UseTeachingResult {
  const { data, loading, error, refresh } = usePluginData<TeachingOverviewV1>("teaching-overview", {
    companyId: companyId ?? "",
  });
  return { overview: data, loading, error, refresh };
}
