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

    // Read each racquet's variant ids (batched), then bulk-update inventoryPolicy per product.
    const productVariants: Array<{ productGid: string; variantIds: string[] }> = [];
    for (const batch of chunk(racquetIds, 50)) {
      const res = await admin.graphql(
        `
        #graphql
        query ProtoRacquetVariants($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on Product {
              id
              variants(first: 100) { nodes { id } }
            }
          }
        }
      `,
        { variables: { ids: batch.map((id) => toProductGid(id)) } },
      );
      const body = (await res.json()) as {
        data?: {
          nodes?: Array<
            { id?: string; variants?: { nodes?: Array<{ id?: string }> } } | null
          >;
        };
      };
      for (const node of body.data?.nodes ?? []) {
        const variantIds = (node?.variants?.nodes ?? [])
          .map((v) => v?.id)
          .filter((id): id is string => Boolean(id));
        if (node?.id && variantIds.length > 0) {
          productVariants.push({ productGid: node.id, variantIds });
        }
      }
    }

    for (const { productGid, variantIds } of productVariants) {
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
        console.error("setRacquetInventoryPolicy userErrors:", JSON.stringify(errors));
      } else {
        updated += variantIds.length;
      }
    }
  } catch (err) {
    console.error("setRacquetInventoryPolicy failed:", err);
  }
  return { updated };
}
