/**
 * `useSkillContent` — the Skills viewer's body seam. Reads the worker's
 * `skill-content` handler (a LIVE, index-gated, containment-checked single-file
 * read of a SKILL.md), keyed by `skillId`. Returns the shared `ReportContentV1`
 * payload the `ReportViewerPanel` already renders. Mirrors `useDocContent`.
 */

import { usePluginData } from "@paperclipai/plugin-sdk/ui";
import type { PluginBridgeError } from "@paperclipai/plugin-sdk/ui";
import type { ReportContentV1 } from "../../contracts/report-content.js";

export interface UseSkillContentResult {
  content: ReportContentV1 | null;
  loading: boolean;
  error: PluginBridgeError | null;
  refresh: () => void;
}

export function useSkillContent(companyId: string | null, skillId: string): UseSkillContentResult {
  const { data, loading, error, refresh } = usePluginData<ReportContentV1>("skill-content", {
    companyId: companyId ?? "",
    skillId,
  });
  return { content: data, loading, error, refresh };
}
