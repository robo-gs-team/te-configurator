import { normalizeProductId, toProductGid } from "~/lib/product-id";

export type ProductSummary = {
  id: string;
  title: string;
};

export type ProductWithImage = {
  id: string;
  title: string;
  imageUrl: string | null;
  variantId: string | null;
  price: number;
};

type ShopifyAdmin = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

type ProductsByIdsResponse = {
  data?: {
    nodes?: Array<{
      id?: string;
      title?: string;
      legacyResourceId?: string;
    } | null>;
  };
};

export async function getProductsByIds(
  admin: ShopifyAdmin,
  productIds: string[],
): Promise<ProductSummary[]> {
  if (productIds.length === 0) return [];

  const response = await admin.graphql(
    `#graphql
      query ProtoProductsByIds($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product {
            id
            title
            legacyResourceId
          }
        }
      }
    `,
    {
      variables: {
        ids: productIds.map((id) => toProductGid(id)),
      },
    },
  );

  const body = (await response.json()) as ProductsByIdsResponse;

  return (body.data?.nodes ?? [])
    .filter((node): node is NonNullable<typeof node> => Boolean(node?.legacyResourceId))
    .map((node) => ({
      id: normalizeProductId(String(node.legacyResourceId)),
      title: node.title ?? "Product",
    }));
}

type ProductsWithImagesResponse = {
  data?: {
    nodes?: Array<{
      legacyResourceId?: string;
      title?: string;
      featuredImage?: { url?: string } | null;
      variants?: {
        nodes?: Array<{ legacyResourceId?: string; price?: string }>;
      };
    } | null>;
  };
};

export async function getProductsWithImages(
  admin: ShopifyAdmin,
  productIds: string[],
): Promise<Map<string, { imageUrl: string | null; variantId: string | null; price: number }>> {
  if (productIds.length === 0) return new Map();

  const response = await admin.graphql(
    `#graphql
      query ProtoProductsWithImages($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product {
            legacyResourceId
            title
            featuredImage {
              url
            }
            variants(first: 1) {
              nodes {
                legacyResourceId
                price
              }
            }
          }
        }
      }
    `,
    {
      variables: {
        ids: productIds.map((id) => toProductGid(id)),
      },
    },
  );

  const body = (await response.json()) as ProductsWithImagesResponse;
  const map = new Map<
    string,
    { imageUrl: string | null; variantId: string | null; price: number }
  >();

  for (const node of body.data?.nodes ?? []) {
    if (!node?.legacyResourceId) continue;
    const id = normalizeProductId(String(node.legacyResourceId));
    const variant = node.variants?.nodes?.[0];
    map.set(id, {
      imageUrl: node.featuredImage?.url ?? null,
      variantId: variant?.legacyResourceId ? String(variant.legacyResourceId) : null,
      price: parseFloat(String(variant?.price ?? "0")) || 0,
    });
  }

  return map;
}
