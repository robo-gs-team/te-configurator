/**
 * Shopify's Admin GraphQL `nodes(ids: [ID!]!)` field accepts at most 250 ids per query. Past that
 * the whole query is rejected — which, for the configurator editor, means the page 500s rather
 * than loading slowly. That is a size the picker fields can reach on their own: a configurator
 * scoped by explicit product ids (racquets, string products, exclusions) accumulates them one
 * merchant click at a time, with nothing in the UI hinting there is a ceiling.
 *
 * So the ceiling is handled here rather than left as a trap. Callers pass however many ids they
 * have; this splits them into legal batches.
 */
export const NODES_BATCH_SIZE = 250;

/** Split into fixed-size chunks. Returns `[]` for an empty input (never a single empty chunk). */
export function chunk<T>(items: T[], size = NODES_BATCH_SIZE): T[][] {
  if (items.length === 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Run `fetchBatch` over each chunk CONCURRENTLY and flatten the results.
 *
 * Concurrent because these are independent reads and the common case is a single chunk, where this
 * costs nothing; serial batching would turn a large picker into a visibly slower page for no
 * benefit. Shopify's cost-based rate limiter is the reason not to go wider than the natural chunk
 * count — at 250 ids per query, reaching a concurrency worth worrying about would take thousands
 * of ids.
 */
export async function fetchInBatches<TIn, TOut>(
  ids: TIn[],
  fetchBatch: (batch: TIn[]) => Promise<TOut[]>,
): Promise<TOut[]> {
  const batches = chunk(ids);
  if (batches.length === 0) return [];
  if (batches.length === 1) return fetchBatch(batches[0]);
  const results = await Promise.all(batches.map(fetchBatch));
  return results.flat();
}
