/**
 * `collect` — run every `WorkSignalSource` against a `CollectionContext` and
 * assemble the `SignalBundle` the pure projections (COS-0d) fold over. This is
 * the ONE orchestration point; it is itself side-effect-free (the
 * `CollectionContext` already abstracts git/gh/fs/clock), so it is fully unit
 * testable with a fixture context and reused verbatim by the scheduled job and
 * the `refresh-board` action.
 *
 * The scope (`null` = full sweep, else a single repo for the hook fast-path)
 * lives on `ctx.scopeRepo`; the COS-0c adapter `makeCollectionContext` is where
 * that scope + the real runners enter. Sources are isolated — a source whose
 * `collect` rejects (a contract violation) is logged and contributes an empty
 * batch rather than failing the whole bundle.
 */

import type { CollectionContext } from "./contracts/collection-context.js";
import type { SignalBatch, SignalBundle, WorkSignalSource } from "./contracts/WorkSignalSource.js";
import { DEFAULT_SOURCES } from "./sources/index.js";

export interface CollectResult {
  readonly bundle: SignalBundle;
  /** Source ids whose collect rejected (should be empty — sources are contractually no-throw). */
  readonly failedSources: string[];
}

/** Run the given sources (default: the production roster) and assemble a bundle. */
export async function collect(
  ctx: CollectionContext,
  sources: readonly WorkSignalSource[] = DEFAULT_SOURCES,
): Promise<CollectResult> {
  const collectedAt = ctx.clock.now();
  const failedSources: string[] = [];

  const settled = await Promise.all(
    sources.map(async (source): Promise<SignalBatch> => {
      try {
        return await source.collect(ctx);
      } catch (err) {
        // A source MUST NOT throw (it should degrade internally). If one does,
        // contain it: log, record, and contribute an empty batch.
        ctx.logger.error(`source ${source.id} threw during collect`, { error: String(err) });
        failedSources.push(source.id);
        return { source: source.id, collectedAt, signals: [], repoFreshness: [] };
      }
    }),
  );

  return { bundle: { collectedAt, batches: settled }, failedSources };
}
