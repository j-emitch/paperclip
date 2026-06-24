/**
 * `useReportContent` — the docs viewer's single-file read seam. Reads the
 * worker's LIVE, index-gated, containment-checked `report-content` handler for
 * the selected `{repo, relPath}`. The worker validates + only ever returns a
 * workspace-relative path, so the UI trusts the contract type. Type-only import.
 *
 * Mount this hook only when a document is actually selected (a child component),
 * so we never fetch for an empty selection.
 */

import { usePluginData } from "@paperclipai/plugin-sdk/ui";
import type { PluginBridgeError } from "@paperclipai/plugin-sdk/ui";
import type { ReportContentV1 } from "../../contracts/index.js";

export interface UseReportContentResult {
  content: ReportContentV1 | null;
  loading: boolean;
  error: PluginBridgeError | null;
  refresh: () => void;
}

export function useReportContent(
  companyId: string | null,
  repo: string,
  relPath: string,
): UseReportContentResult {
  const { data, loading, error, refresh } = usePluginData<ReportContentV1>("report-content", {
    companyId: companyId ?? "",
    repo,
    relPath,
  });
  return { content: data, loading, error, refresh };
}
