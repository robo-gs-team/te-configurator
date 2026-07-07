import { parseJson } from "~/lib/configurator.types";
import { toProductGid } from "~/lib/product-id";
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
 * @returns the number of variants updated.
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
): Promise<{ updated: number }> {
  const policy = allow ? "CONTINUE" : "DENY";
  let updated = 0;
  try {
    const explicitIds = parseJson<string[]>(configurator.productIds ?? "[]", []);
    const collectionIds = parseJson<string[]>(configurator.collectionIds ?? "[]", []);
    const stringProductIds = parseJson<string[]>(configurator.stringProductIds ?? "[]", []);
    const stringCollectionIds = parseJson<string[]>(configurator.stringCollectionIds ?? "[]", []);
    const allCollectionIds = [...collectionIds, ...stringCollectionIds];
    const collectionProducts =
      allCollectionIds.length > 0 ? await getProductsInCollections(admin, allCollectionIds) : [];
    const racquetIds = Array.from(
      new Set([
        ...explicitIds,
        ...stringProductIds,
        ...collectionProducts.map((p) => p.id),
      ]),
    );
    if (racquetIds.length === 0) return { updated: 0 };

    // Read each product's variants (batched, batches in parallel), fetching the CURRENT
    // inventoryPolicy so we can skip variants already at the target — the common case on a re-save
    // (this runs on every save while the override is on), which then costs zero mutations.
    const readBatches = await mapLimit(chunk(racquetIds, 50), 5, async (batch) => {
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

    // Only mutate products that actually have at least one variant off-target.
    const productVariants: Array<{ productGid: string; variantIds: string[] }> = [];
    for (const nodes of readBatches) {
      for (const node of nodes) {
        const variantIds = (node?.variants?.nodes ?? [])
          .filter((v) => v?.id && v.inventoryPolicy !== policy)
          .map((v) => v!.id as string);
        if (node?.id && variantIds.length > 0) {
          productVariants.push({ productGid: node.id, variantIds });
        }
      }
    }
    if (productVariants.length === 0) return { updated: 0 };

    // Bulk-update inventoryPolicy per product, several products in flight at once.
    const counts = await mapLimit(productVariants, 8, async ({ productGid, variantIds }) => {
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
        return 0;
      }
      return variantIds.length;
    });
    updated = counts.reduce((sum, n) => sum + n, 0);
  } catch (err) {
    console.error("setConfiguratorInventoryPolicy failed:", err);
  }
  return { updated };
}
