import { normalizeProductId, toProductGid } from "~/lib/product-id";

export type ProductSummary = {
  id: string;
  title: string;
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
