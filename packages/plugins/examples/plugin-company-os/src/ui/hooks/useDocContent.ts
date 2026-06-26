/**
 * `useDocContent` — the Docs viewer's single-file read seam. Reads the worker's
 * LIVE, index-gated, containment-checked `doc-content` handler for the selected
 * `docId` (PF-9): the worker maps `docId → checkoutKey + relPath` against the doc
 * index and only ever returns a workspace-relative path, so the UI trusts the
 * `ReportContentV1` contract type (the SAME payload the Reports viewer renders).
 *
 * Mount this hook only when a doc is actually selected (a child component), so we
 * never fetch for an empty selection.
 */

import { usePluginData } from "@paperclipai/plugin-sdk/ui";
import type { PluginBridgeError } from "@paperclipai/plugin-sdk/ui";
import type { ReportContentV1 } from "../../contracts/index.js";

export interface UseDocContentResult {
  content: ReportContentV1 | null;
  loading: boolean;
  error: PluginBridgeError | null;
  refresh: () => void;
}

export function useDocContent(companyId: string | null, docId: string): UseDocContentResult {
  const { data, loading, error, refresh } = usePluginData<ReportContentV1>("doc-content", {
    companyId: companyId ?? "",
    docId,
  });
  return { content: data, loading, error, refresh };
}
