/**
 * `useSkillsCatalog` — the Skills tab's tree data seam. Reads the worker's
 * `skills-catalog` handler (validated, version-gated cache row — the origin →
 * collection → skill tree `deriveSkillsCatalog` folds). Type-only contract import
 * keeps the browser bundle zod-free, mirroring `useDocIndex`.
 */

import { usePluginData } from "@paperclipai/plugin-sdk/ui";
import type { PluginBridgeError } from "@paperclipai/plugin-sdk/ui";
import type { SkillsCatalogV1 } from "../../contracts/index.js";

export interface UseSkillsCatalogResult {
  catalog: SkillsCatalogV1 | null;
  loading: boolean;
  error: PluginBridgeError | null;
  refresh: () => void;
}

export function useSkillsCatalog(companyId: string | null): UseSkillsCatalogResult {
  const { data, loading, error, refresh } = usePluginData<SkillsCatalogV1>("skills-catalog", {
    companyId: companyId ?? "",
  });
  return { catalog: data, loading, error, refresh };
}
