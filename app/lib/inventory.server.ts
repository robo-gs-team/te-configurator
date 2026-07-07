import { parseJson } from "~/lib/configurator.types";
import { normalizeProductId, toProductGid } from "~/lib/product-id";
import { getProductsInCollections } from "~/lib/shopify-collections.server";

type ShopifyAdmin = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Run `fn` over `items` with at most `limit` in flight at once, preserving result order. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}

/**
 * Set the Shopify `inventoryPolicy` on every variant of every product linked to the configurator
 * — BOTH the racquets (explicit productIds ∪ racquet-collection products) AND the strings
 * (stringProductIds ∪ string-collection products), since the shop provides the strings and they
 * shouldn't block checkout. CONTINUE lets a variant be ordered while out of stock (the only way
 * Shopify's /cart/add.js accepts an OOS item); DENY blocks it.
 *
 * Best-effort — never throws, so a transient Shopify error can't fail the merchant's save. Note
 * this changes the REAL per-variant setting: it affects every sales channel, not just this app.
 *
 * @returns the number of variants updated, split by whether the product is a racquet or a string
 *   (so the UI can report "N racquet + M string variants" honestly — the string count is usually
 *   the large one because it covers every product in the linked string collection(s)).
 */
export async function setConfiguratorInventoryPolicy(
  admin: ShopifyAdmin,
  configurator: {
    productIds: string;
    collectionIds: string;
    stringProductIds?: string;
    stringCollectionIds?: string;
  },
  allow: boolean,
): Promise<{ updated: number; racquets: number; strings: number }> {
  const policy = allow ? "CONTINUE" : "DENY";
  const empty = { updated: 0, racquets: 0, strings: 0 };
  let racquets = 0;
  let strings = 0;
  try {
    const explicitIds = parseJson<string[]>(configurator.productIds ?? "[]", []);
    const collectionIds = parseJson<string[]>(configurator.collectionIds ?? "[]", []);
    const stringProductIds = parseJson<string[]>(configurator.stringProductIds ?? "[]", []);
    const stringCollectionIds = parseJson<string[]>(configurator.stringCollectionIds ?? "[]", []);

    // Resolve racquet-sourced and string-sourced product ids SEPARATELY (collections fetched in
    // parallel) so each mutated product can be attributed to the right bucket in the count.
    const [racquetCollectionProducts, stringCollectionProducts] = await Promise.all([
      collectionIds.length > 0 ? getProductsInCollections(admin, collectionIds) : Promise.resolve([]),
      stringCollectionIds.length > 0
        ? getProductsInCollections(admin, stringCollectionIds)
        : Promise.resolve([]),
    ]);
    const racquetIdSet = new Set(
      [...explicitIds, ...racquetCollectionProducts.map((p) => p.id)].map((id) =>
        normalizeProductId(String(id)),
      ),
    );
    const stringIdSet = new Set(
      [...stringProductIds, ...stringCollectionProducts.map((p) => p.id)].map((id) =>
        normalizeProductId(String(id)),
      ),
    );
    // Union of all product ids to touch (racquet classification wins if somehow in both).
    const allIds = Array.from(new Set([...racquetIdSet, ...stringIdSet]));
    if (allIds.length === 0) return empty;

    // Read each product's variants (batched, batches in parallel), fetching the CURRENT
    // inventoryPolicy so we can skip variants already at the target — the common case on a re-save
    // (this runs on every save while the override is on), which then costs zero mutations.
    const readBatches = await mapLimit(chunk(allIds, 50), 5, async (batch) => {
      const res = await admin.graphql(
        `
        #graphql
        query ProtoRacquetVariants($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on Product {
              id
              variants(first: 100) { nodes { id inventoryPolicy } }
            }
          }
        }
      `,
        { variables: { ids: batch.map((id) => toProductGid(id)) } },
      );
      const body = (await res.json()) as {
        data?: {
          nodes?: Array<
            | {
                id?: string;
                variants?: { nodes?: Array<{ id?: string; inventoryPolicy?: string }> };
              }
            | null
          >;
        };
      };
      return body.data?.nodes ?? [];
    });

    // Only mutate products that actually have at least one variant off-target. Tag each with its
    // bucket (racquet vs string) via the normalized product id so the count can be split.
    const productVariants: Array<{
      productGid: string;
      variantIds: string[];
      kind: "racquet" | "string";
    }> = [];
    for (const nodes of readBatches) {
      for (const node of nodes) {
        const variantIds = (node?.variants?.nodes ?? [])
          .filter((v) => v?.id && v.inventoryPolicy !== policy)
          .map((v) => v!.id as string);
        if (node?.id && variantIds.length > 0) {
          const normId = normalizeProductId(node.id);
          const kind = racquetIdSet.has(normId) ? "racquet" : "string";
          productVariants.push({ productGid: node.id, variantIds, kind });
        }
      }
    }
    if (productVariants.length === 0) return empty;

    // Bulk-update inventoryPolicy per product, several products in flight at once.
    const results = await mapLimit(productVariants, 8, async ({ productGid, variantIds, kind }) => {
      const res = await admin.graphql(
        `
        #graphql
        mutation ProtoSetInventoryPolicy($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkUpdate(productId: $productId, variants: $variants) {
            userErrors { field message }
          }
        }
      `,
        {
          variables: {
            productId: productGid,
            variants: variantIds.map((id) => ({ id, inventoryPolicy: policy })),
          },
        },
      );
      const body = (await res.json()) as {
        data?: { productVariantsBulkUpdate?: { userErrors?: Array<{ message?: string }> } };
      };
      const errors = body.data?.productVariantsBulkUpdate?.userErrors ?? [];
      if (errors.length > 0) {
        console.error("setConfiguratorInventoryPolicy userErrors:", JSON.stringify(errors));
        return { racquet: 0, string: 0 };
      }
      return kind === "racquet"
        ? { racquet: variantIds.length, string: 0 }
        : { racquet: 0, string: variantIds.length };
    });
    for (const r of results) {
      racquets += r.racquet;
      strings += r.string;
    }
  } catch (err) {
    console.error("setConfiguratorInventoryPolicy failed:", err);
  }
  return { updated: racquets + strings, racquets, strings };
}
