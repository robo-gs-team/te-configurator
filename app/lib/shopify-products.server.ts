import { normalizeProductId, toProductGid } from "~/lib/product-id";

export type ProductSummary = {
  id: string;
  title: string;
};

// A single sellable variant of a string product, carrying enough to (a) judge availability
// per-variant, and (b) resolve the exact variant matching the shopper's gauge/color choice at
// cart time. `selectedOptions` is Shopify's raw option list (e.g. [{name:"Color",value:"Black"},
// {name:"Size",value:"16"}]).
export type ProductVariantInfo = {
  variantId: string;
  price: number;
  availableForSale: boolean;
  selectedOptions: Array<{ name: string; value: string }>;
};

export type ProductWithImage = {
  id: string;
  title: string;
  imageUrl: string | null;
  variantId: string | null;
  price: number;
  availableForSale?: boolean;
  variants?: ProductVariantInfo[];
  productType?: string;
  tags?: string[];
  stringType?: string | null;
  stringType2?: string | null;
};

/** Map Shopify's raw variant nodes to our ProductVariantInfo[], dropping any without an id. */
export function mapProductVariants(
  nodes:
    | Array<{
        legacyResourceId?: string;
        price?: string;
        availableForSale?: boolean;
        selectedOptions?: Array<{ name?: string; value?: string }>;
      }>
    | undefined,
): ProductVariantInfo[] {
  return (nodes ?? [])
    .filter((v) => Boolean(v?.legacyResourceId))
    .map((v) => ({
      variantId: String(v.legacyResourceId),
      price: parseFloat(String(v.price ?? "0")) || 0,
      availableForSale: v.availableForSale !== false,
      selectedOptions: (v.selectedOptions ?? [])
        .filter((o) => o?.name != null && o?.value != null)
        .map((o) => ({ name: String(o.name), value: String(o.value) })),
    }));
}

/**
 * Pick the representative default variant + price + product-level availability from a variant
 * list: the price/id come from the first AVAILABLE variant (so the option's default isn't a
 * sold-out SKU), and a product counts as available if ANY of its variants is sellable — the whole
 * point, since a product with a depleted first variant but in-stock others is very much for sale.
 */
export function summarizeVariants(variants: ProductVariantInfo[]): {
  variantId: string | null;
  price: number;
  availableForSale: boolean;
} {
  const firstAvailable = variants.find((v) => v.availableForSale) ?? variants[0];
  return {
    variantId: firstAvailable?.variantId ?? null,
    price: firstAvailable?.price ?? 0,
    availableForSale: variants.some((v) => v.availableForSale),
  };
}

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
          tags?: string[];
          stringType?: { value?: string } | null;
          stringType2?: { value?: string } | null;
          variants?: {
            nodes?: Array<{
              legacyResourceId?: string;
              price?: string;
              availableForSale?: boolean;
              selectedOptions?: Array<{ name?: string; value?: string }>;
            }>;
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
      const variants = mapProductVariants(node.variants?.nodes);
      const summary = summarizeVariants(variants);
      return {
        id: normalizeProductId(String(node.legacyResourceId)),
        title: node.title ?? "Product",
        productType: node.productType ?? undefined,
        tags: node.tags ?? [],
        stringType: node.stringType?.value ?? null,
        stringType2: node.stringType2?.value ?? null,
        imageUrl: resolveProductImageUrl(node),
        variantId: summary.variantId,
        price: summary.price,
        availableForSale: summary.availableForSale,
        variants,
      };
    });
}

export type ProductMeta = {
  imageUrl: string | null;
  variantId: string | null;
  price: number;
  title: string;
  productType?: string;
  tags: string[];
  stringType: string | null;
  stringType2: string | null;
};

export async function getProductsWithImages(
  admin: ShopifyAdmin,
  productIds: string[],
): Promise<Map<string, ProductMeta>> {
  if (productIds.length === 0) return new Map();

  const response = await admin.graphql(
    `#graphql
      query ProtoProductsWithImages($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product {
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
  const map = new Map<string, ProductMeta>();

  for (const node of body.data?.nodes ?? []) {
    if (!node?.legacyResourceId) continue;
    const id = normalizeProductId(String(node.legacyResourceId));
    const variant = node.variants?.nodes?.[0];
    map.set(id, {
      imageUrl: resolveProductImageUrl(node),
      variantId: variant?.legacyResourceId ? String(variant.legacyResourceId) : null,
      price: parseFloat(String(variant?.price ?? "0")) || 0,
      title: node.title ?? "Product",
      productType: node.productType ?? undefined,
      tags: node.tags ?? [],
      stringType: node.stringType?.value ?? null,
      stringType2: node.stringType2?.value ?? null,
    });
  }

  return map;
}
