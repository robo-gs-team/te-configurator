import type { ConfiguratorWithRelations } from "~/lib/configurator.types";
import { parseJson } from "~/lib/configurator.types";
import type { CollectionProduct } from "~/lib/shopify-collections.server";
import { getProductsInCollections } from "~/lib/shopify-collections.server";
import { getProductsWithImages } from "~/lib/shopify-products.server";

type ShopifyAdmin = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

function collectionProductToOption(
  product: CollectionProduct,
  sortOrder: number,
) {
  return {
    id: `collection-${product.id}`,
    optionGroupId: "",
    label: product.title,
    value: product.title.toLowerCase().replace(/\s+/g, "_"),
    imageUrl: product.imageUrl,
    previewLayer: product.imageUrl,
    priceAdjust: product.price,
    variantId: product.variantId,
    productId: product.id,
    colorHex: null as string | null,
    sortOrder,
    isDefault: sortOrder === 0,
    metadata: JSON.stringify({
      type: product.productType,
      gauges: ["16", "17"],
      colors: ["Black", "White", "Natural"],
      fromCollection: true,
    }),
  };
}

export async function enrichConfiguratorWithShopifyData(
  admin: ShopifyAdmin,
  configurator: ConfiguratorWithRelations,
): Promise<ConfiguratorWithRelations> {
  const manualProductIds = configurator.steps
    .flatMap((step) => step.optionGroups)
    .flatMap((group) => group.options)
    .map((opt) => opt.productId)
    .filter((id): id is string => Boolean(id));

  const imageByProductId =
    manualProductIds.length > 0
      ? await getProductsWithImages(admin, manualProductIds)
      : new Map<string, { imageUrl: string | null; variantId: string | null }>();

  const enrichedSteps = await Promise.all(
    configurator.steps.map(async (step) => ({
      ...step,
      optionGroups: await Promise.all(
        step.optionGroups.map(async (group) => {
          const collectionIds = parseJson<string[]>(group.collectionIds ?? "[]", []);
          const collectionProducts =
            collectionIds.length > 0
              ? await getProductsInCollections(admin, collectionIds)
              : [];

          const manualOptions = group.options.map((option) => {
            const productMeta = option.productId
              ? imageByProductId.get(option.productId)
              : undefined;
            return {
              ...option,
              imageUrl: option.imageUrl ?? productMeta?.imageUrl ?? null,
              previewLayer: option.previewLayer ?? option.imageUrl ?? productMeta?.imageUrl ?? null,
              variantId: option.variantId ?? productMeta?.variantId ?? null,
            };
          });

          const collectionOptions = collectionProducts.map((product, index) =>
            collectionProductToOption(product, manualOptions.length + index),
          );

          return {
            ...group,
            options: [...manualOptions, ...collectionOptions],
          };
        }),
      ),
    })),
  );

  return {
    ...configurator,
    steps: enrichedSteps,
  };
}
