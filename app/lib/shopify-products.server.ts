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
  productType?: string;
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

type ProductImageNode = {
  featuredImage?: { url?: string } | null;
  featuredMedia?: {
    preview?: { image?: { url?: string } | null } | null;
  } | null;
  images?: { nodes?: Array<{ url?: string } | null> };
};

export function resolveProductImageUrl(node: ProductImageNode): string | null {
  return (
    node.featuredImage?.url ??
    node.featuredMedia?.preview?.image?.url ??
    node.images?.nodes?.find((image) => image?.url)?.url ??
    null
  );
}

type ProductsWithImagesResponse = {
  data?: {
    nodes?: Array<
      | ({
          legacyResourceId?: string;
          title?: string;
          productType?: string;
          variants?: {
            nodes?: Array<{ legacyResourceId?: string; price?: string }>;
          };
        } & ProductImageNode)
      | null
    >;
  };
};

export async function getProductsDetailedByIds(
  admin: ShopifyAdmin,
  productIds: string[],
): Promise<ProductWithImage[]> {
  if (productIds.length === 0) return [];

  const response = await admin.graphql(
    `#graphql
      query ProtoProductsDetailed($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product {
            legacyResourceId
            title
            productType
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

  return (body.data?.nodes ?? [])
    .filter((node): node is NonNullable<typeof node> => Boolean(node?.legacyResourceId))
    .map((node) => {
      const variant = node.variants?.nodes?.[0];
      return {
        id: normalizeProductId(String(node.legacyResourceId)),
        title: node.title ?? "Product",
        productType: node.productType ?? undefined,
        imageUrl: resolveProductImageUrl(node),
        variantId: variant?.legacyResourceId ? String(variant.legacyResourceId) : null,
        price: parseFloat(String(variant?.price ?? "0")) || 0,
      };
    });
}

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
      imageUrl: resolveProductImageUrl(node),
      variantId: variant?.legacyResourceId ? String(variant.legacyResourceId) : null,
      price: parseFloat(String(variant?.price ?? "0")) || 0,
    });
  }

  return map;
}
