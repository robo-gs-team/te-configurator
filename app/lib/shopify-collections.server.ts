import { normalizeCollectionId, toCollectionGid } from "~/lib/collection-id";
import { normalizeProductId } from "~/lib/product-id";

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

export async function productBelongsToCollections(
  admin: ShopifyAdmin,
  productId: string,
  collectionIds: string[],
  shopDomain?: string,
): Promise<boolean> {
  if (collectionIds.length === 0) return false;

  const normalizedTargets = new Set(
    collectionIds.map((id) => normalizeCollectionId(id)),
  );
  const productCollections = await getProductCollectionIds(
    admin,
    productId,
    shopDomain,
  );

  return productCollections.some((id) => normalizedTargets.has(id));
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
