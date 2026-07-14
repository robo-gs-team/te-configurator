import { normalizeCollectionId, toCollectionGid } from "~/lib/collection-id";
import { normalizeProductId } from "~/lib/product-id";
import {
  mapProductVariants,
  resolveProductImageUrl,
  summarizeVariants,
  type ProductVariantInfo,
} from "~/lib/shopify-products.server";

type ShopifyAdmin = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export type CollectionSummary = {
  id: string;
  title: string;
};

export type CollectionProduct = {
  id: string;
  title: string;
  productType: string;
  tags: string[];
  stringType: string | null;
  stringType2: string | null;
  imageUrl: string | null;
  variantId: string;
  price: number;
  availableForSale: boolean;
  variants: ProductVariantInfo[];
};

type ProductCollectionsResponse = {
  data?: {
    product?: {
      collections?: {
        nodes?: Array<{ legacyResourceId?: string }>;
      };
    };
  };
};

type CollectionsByIdsResponse = {
  data?: {
    nodes?: Array<{
      id?: string;
      title?: string;
      legacyResourceId?: string;
    } | null>;
  };
};

const CACHE_TTL_MS = 60_000;
const productCollectionsCache = new Map<
  string,
  { ids: string[]; expires: number }
>();

function cacheKey(shop: string, productId: string) {
  return `${shop}:${normalizeProductId(productId)}`;
}

export async function getProductCollectionIds(
  admin: ShopifyAdmin,
  productId: string,
  shopDomain?: string,
): Promise<string[]> {
  const normalizedProductId = normalizeProductId(productId);
  const key = shopDomain ? cacheKey(shopDomain, normalizedProductId) : null;

  if (key) {
    const cached = productCollectionsCache.get(key);
    if (cached && cached.expires > Date.now()) {
      return cached.ids;
    }
  }

  const response = await admin.graphql(
    `#graphql
      query ProtoProductCollections($id: ID!) {
        product(id: $id) {
          collections(first: 250) {
            nodes {
              legacyResourceId
            }
          }
        }
      }
    `,
    {
      variables: {
        id: `gid://shopify/Product/${normalizedProductId}`,
      },
    },
  );

  const body = (await response.json()) as ProductCollectionsResponse;
  const ids =
    body.data?.product?.collections?.nodes
      ?.map((node) => normalizeCollectionId(String(node.legacyResourceId ?? "")))
      .filter(Boolean) ?? [];

  if (key) {
    productCollectionsCache.set(key, {
      ids,
      expires: Date.now() + CACHE_TTL_MS,
    });
  }

  return ids;
}

export async function getCollectionsByIds(
  admin: ShopifyAdmin,
  collectionIds: string[],
): Promise<CollectionSummary[]> {
  if (collectionIds.length === 0) return [];

  const response = await admin.graphql(
    `#graphql
      query ProtoCollectionsByIds($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Collection {
            id
            title
            legacyResourceId
          }
        }
      }
    `,
    {
      variables: {
        ids: collectionIds.map((id) => toCollectionGid(id)),
      },
    },
  );

  const body = (await response.json()) as CollectionsByIdsResponse;

  return (body.data?.nodes ?? [])
    .filter((node): node is NonNullable<typeof node> => Boolean(node?.legacyResourceId))
    .map((node) => ({
      id: normalizeCollectionId(String(node.legacyResourceId)),
      title: node.title ?? "Collection",
    }));
}

type CollectionProductsResponse = {
  data?: {
    collection?: {
      products?: {
        nodes?: Array<{
          legacyResourceId?: string;
          title?: string;
          productType?: string;
          tags?: string[];
          stringType?: { value?: string } | null;
          stringType2?: { value?: string } | null;
          featuredImage?: { url?: string } | null;
          variants?: {
            nodes?: Array<{
              legacyResourceId?: string;
              price?: string;
              availableForSale?: boolean;
              selectedOptions?: Array<{ name?: string; value?: string }>;
            }>;
          };
        }>;
        pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
      };
    };
  };
};

async function fetchCollectionProducts(
  admin: ShopifyAdmin,
  collectionId: string,
): Promise<CollectionProduct[]> {
  const results: CollectionProduct[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await admin.graphql(
      `#graphql
        query ProtoCollectionProducts($id: ID!, $cursor: String) {
          collection(id: $id) {
            products(first: 100, after: $cursor) {
              nodes {
                legacyResourceId
                title
                productType
                tags
                stringType: metafield(namespace: "global", key: "string_type") { value }
                stringType2: metafield(namespace: "custom", key: "string_type2") { value }
                featuredImage {
                  url
                }
                featuredMedia {
                  preview {
                    image {
                      url
                    }
                  }
                }
                images(first: 1) {
                  nodes {
                    url
                  }
                }
                variants(first: 100) {
                  nodes {
                    legacyResourceId
                    price
                    availableForSale
                    selectedOptions {
                      name
                      value
                    }
                  }
                }
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        }
      `,
      { variables: { id: toCollectionGid(collectionId), cursor } },
    );

    const body = (await response.json()) as CollectionProductsResponse;
    const products = body.data?.collection?.products;

    for (const node of products?.nodes ?? []) {
      const id = normalizeProductId(String(node.legacyResourceId ?? ""));
      const variants = mapProductVariants(node.variants?.nodes);
      const summary = summarizeVariants(variants);
      if (!id || !summary.variantId) continue;
      results.push({
        id,
        title: node.title ?? "Product",
        productType: node.productType ?? "String",
        tags: node.tags ?? [],
        stringType: node.stringType?.value ?? null,
        stringType2: node.stringType2?.value ?? null,
        imageUrl: resolveProductImageUrl(node),
        variantId: summary.variantId,
        price: summary.price,
        availableForSale: summary.availableForSale,
        variants,
      });
    }

    hasNextPage = products?.pageInfo?.hasNextPage ?? false;
    cursor = products?.pageInfo?.endCursor ?? null;
  }

  return results;
}

export async function getProductsInCollections(
  admin: ShopifyAdmin,
  collectionIds: string[],
): Promise<CollectionProduct[]> {
  if (collectionIds.length === 0) return [];

  // Fetch all collections in parallel instead of sequentially
  const allResults = await Promise.all(
    collectionIds.map((id) => fetchCollectionProducts(admin, id)),
  );

  const seen = new Map<string, CollectionProduct>();
  for (const products of allResults) {
    for (const product of products) {
      if (!seen.has(product.id)) seen.set(product.id, product);
    }
  }

  return Array.from(seen.values());
}

/**
 * Lightweight sibling of `getProductsInCollections`: returns ONLY the (normalized) product ids in
 * the given collections, deduped. Callers that just need the membership list — not the per-product
 * variant matrix / metafields / images that `getProductsInCollections` fetches — should use this:
 * the GraphQL query cost is ~an order of magnitude lower and it pages at 250 (vs 100), so on a
 * large string collection this is dramatically fewer/cheaper round-trips.
 */
export async function getProductIdsInCollections(
  admin: ShopifyAdmin,
  collectionIds: string[],
): Promise<string[]> {
  if (collectionIds.length === 0) return [];
  const all = await Promise.all(
    collectionIds.map((id) => fetchCollectionProductIds(admin, id)),
  );
  return Array.from(new Set(all.flat()));
}

async function fetchCollectionProductIds(
  admin: ShopifyAdmin,
  collectionId: string,
): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await admin.graphql(
      `#graphql
        query ProtoCollectionProductIds($id: ID!, $cursor: String) {
          collection(id: $id) {
            products(first: 250, after: $cursor) {
              nodes { legacyResourceId }
              pageInfo { hasNextPage endCursor }
            }
          }
        }
      `,
      { variables: { id: toCollectionGid(collectionId), cursor } },
    );
    const body = (await response.json()) as {
      data?: {
        collection?: {
          products?: {
            nodes?: Array<{ legacyResourceId?: string }>;
            pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
          };
        };
      };
    };
    const products = body.data?.collection?.products;
    for (const node of products?.nodes ?? []) {
      if (node?.legacyResourceId) ids.push(normalizeProductId(String(node.legacyResourceId)));
    }
    hasNextPage = products?.pageInfo?.hasNextPage ?? false;
    cursor = products?.pageInfo?.endCursor ?? null;
  }

  return ids;
}
