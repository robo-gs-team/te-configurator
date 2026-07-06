import type { Addon, ConfiguratorWithRelations } from "~/lib/configurator.types";
import { parseJson } from "~/lib/configurator.types";
import type { CollectionProduct } from "~/lib/shopify-collections.server";
import { getProductsInCollections } from "~/lib/shopify-collections.server";
import {
  getProductsDetailedByIds,
  getProductsWithImages,
  type ProductMeta,
} from "~/lib/shopify-products.server";

type ShopifyAdmin = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

// The string-catalog filter chips (storefront/components/StringingConfigurator.tsx) filter by
// these exact category names. Merchants may store this in a purpose-built metafield (the
// "String Type" / "String Type2" fields this store uses), in tags, or not at all — a store's
// Shopify "Product type" field is often just a broad top-level bucket shared by every string
// (e.g. "Strings", matching the storefront's own nav), so it's checked last.
const STRING_TYPE_CATEGORIES = ["Polyester", "Multifilament", "Natural gut", "Synthetic gut"] as const;

// Extra phrases that reliably imply a category but don't contain the category's own words —
// used only for title inference, where tennis-string names encode the material by convention.
// Deliberately conservative (whole recognizable terms) to avoid mislabeling. "nylon" is the
// standard material name for synthetic gut; "co-poly"/"copoly" for polyester.
const STRING_TYPE_TITLE_ALIASES: Array<{ category: string; needles: string[] }> = [
  { category: "Natural gut", needles: ["natural gut"] },
  { category: "Synthetic gut", needles: ["synthetic gut", "nylon"] },
  { category: "Multifilament", needles: ["multifilament", "multi-filament"] },
  { category: "Polyester", needles: ["polyester", "co-poly", "copoly"] },
];

/** Case-insensitively match a raw value against the canonical category names, if any. */
function matchStringTypeCategory(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase();
  return STRING_TYPE_CATEGORIES.find((category) => normalized.includes(category.toLowerCase()));
}

/** Infer a category from a product title, using both the category words and known aliases. */
function inferStringTypeFromTitle(title: string | undefined): string | undefined {
  const direct = matchStringTypeCategory(title);
  if (direct) return direct;
  if (!title) return undefined;
  const normalized = title.toLowerCase();
  return STRING_TYPE_TITLE_ALIASES.find((alias) =>
    alias.needles.some((needle) => normalized.includes(needle)),
  )?.category;
}

function resolveStringType(
  title: string | undefined,
  stringType: string | null | undefined,
  stringType2: string | null | undefined,
  tags: string[] | undefined,
  productType: string | undefined,
): string {
  // Explicit merchant-set metafields win.
  const metafieldMatch = matchStringTypeCategory(stringType) ?? matchStringTypeCategory(stringType2);
  if (metafieldMatch) return metafieldMatch;

  const tagMatch = STRING_TYPE_CATEGORIES.find((category) =>
    (tags ?? []).some((tag) => tag.toLowerCase().includes(category.toLowerCase())),
  );
  if (tagMatch) return tagMatch;

  // Then infer from the product title — most tennis strings name their material (e.g.
  // "…Natural Gut Tennis String") even when no metafield/tag is set.
  const titleMatch = inferStringTypeFromTitle(title);
  if (titleMatch) return titleMatch;

  return matchStringTypeCategory(productType) ?? "String";
}

function shopifyProductToOption(
  product: CollectionProduct | {
    id: string;
    title: string;
    productType?: string;
    tags?: string[];
    stringType?: string | null;
    stringType2?: string | null;
    imageUrl: string | null;
    variantId: string | null;
    price: number;
  },
  sortOrder: number,
  idPrefix: string,
) {
  return {
    id: `${idPrefix}-${product.id}`,
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
      type: resolveStringType(
        product.title,
        "stringType" in product ? product.stringType : undefined,
        "stringType2" in product ? product.stringType2 : undefined,
        "tags" in product ? product.tags : undefined,
        "productType" in product ? product.productType : undefined,
      ),
      gauges: ["16", "17"],
      colors: ["Black", "White", "Natural"],
      fromShopify: true,
    }),
  };
}

async function resolveAddonProducts(
  admin: ShopifyAdmin,
  addon: Addon,
): Promise<
  Array<{
    id: string;
    name: string;
    description: string | null;
    imageUrl: string | null;
    price: number;
    variantId: string | null;
    maxQuantity: number;
    sortOrder: number;
    metadata: Record<string, unknown>;
  }>
> {
  const productIds = parseJson<string[]>(addon.productIds ?? "[]", []);
  const collectionIds = parseJson<string[]>(addon.collectionIds ?? "[]", []);
  const priceOverride = addon.price > 0 ? addon.price : null;

  const fromProducts =
    productIds.length > 0 ? await getProductsDetailedByIds(admin, productIds) : [];
  const fromCollections =
    collectionIds.length > 0
      ? await getProductsInCollections(admin, collectionIds)
      : [];

  const seen = new Map<string, CollectionProduct | (typeof fromProducts)[0]>();
  for (const product of [...fromProducts, ...fromCollections]) {
    if (!seen.has(product.id)) seen.set(product.id, product);
  }

  if (seen.size > 0) {
    return Array.from(seen.values()).map((product, index) => ({
      id: `${addon.id}-product-${product.id}`,
      name: addon.name.trim() || product.title,
      description: addon.description,
      imageUrl: product.imageUrl,
      price: priceOverride ?? product.price,
      variantId: product.variantId,
      maxQuantity: addon.maxQuantity,
      sortOrder: addon.sortOrder + index,
      metadata: { parentAddonId: addon.id, productId: product.id },
    }));
  }

  if (addon.variantId) {
    return [
      {
        id: addon.id,
        name: addon.name,
        description: addon.description,
        imageUrl: addon.imageUrl,
        price: addon.price,
        variantId: addon.variantId,
        maxQuantity: addon.maxQuantity,
        sortOrder: addon.sortOrder,
        metadata: parseJson(addon.metadata, {}),
      },
    ];
  }

  return [
    {
      id: addon.id,
      name: addon.name,
      description: addon.description,
      imageUrl: addon.imageUrl,
      price: addon.price,
      variantId: null,
      maxQuantity: addon.maxQuantity,
      sortOrder: addon.sortOrder,
      metadata: parseJson(addon.metadata, {}),
    },
  ];
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

  // Fetch top-level string collection + individual string products in parallel with the
  // image resolution
  const stringCollectionIds = parseJson<string[]>(
    (configurator as ConfiguratorWithRelations & { stringCollectionIds?: string })
      .stringCollectionIds ?? "[]",
    [],
  );
  const stringProductIds = parseJson<string[]>(
    (configurator as ConfiguratorWithRelations & { stringProductIds?: string })
      .stringProductIds ?? "[]",
    [],
  );
  // Products the merchant explicitly excluded — hidden from the string list regardless of which
  // collection/product source they came in through (e.g. a stringing machine in a string collection).
  const excludedIds = new Set(
    parseJson<string[]>(
      (configurator as ConfiguratorWithRelations & { excludedProductIds?: string })
        .excludedProductIds ?? "[]",
      [],
    ),
  );
  const isExcluded = (id: string | null | undefined) => Boolean(id) && excludedIds.has(String(id));

  const [imageByProductId, stringCollectionProducts, stringIndividualProducts] = await Promise.all([
    manualProductIds.length > 0
      ? getProductsWithImages(admin, manualProductIds)
      : Promise.resolve(new Map<string, ProductMeta>()),
    stringCollectionIds.length > 0
      ? getProductsInCollections(admin, stringCollectionIds)
      : Promise.resolve([]),
    stringProductIds.length > 0
      ? getProductsDetailedByIds(admin, stringProductIds)
      : Promise.resolve([]),
  ]);

  // Dedup — a merchant could add the same product both via a collection and individually —
  // then drop any explicitly-excluded products (e.g. a stringing machine).
  const topLevelStringProducts = [
    ...stringCollectionProducts,
    ...stringIndividualProducts.filter(
      (p) => !stringCollectionProducts.some((cp) => cp.id === p.id),
    ),
  ].filter((p) => !isExcluded(p.id));

  const enrichedSteps = await Promise.all(
    configurator.steps.map(async (step) => ({
      ...step,
      optionGroups: await Promise.all(
        step.optionGroups.map(async (group) => {
          const collectionIds = parseJson<string[]>(group.collectionIds ?? "[]", []);
          const groupProductIds = parseJson<string[]>(group.productIds ?? "[]", []);

          const collectionProducts =
            collectionIds.length > 0
              ? await getProductsInCollections(admin, collectionIds)
              : [];
          const directProducts =
            groupProductIds.length > 0
              ? await getProductsDetailedByIds(admin, groupProductIds)
              : [];

          // If this is the string group and a top-level string collection was configured,
          // merge those products in (deduped by product id).
          const isStringGroup = /string/i.test(group.name);
          const extraStringProducts =
            isStringGroup && topLevelStringProducts.length > 0
              ? topLevelStringProducts
              : [];

          // For a stringing config that sources strings from the top-level String collections/
          // products, ignore this group's legacy MANUAL options entirely — those are leftovers
          // from the old step-based editor (e.g. a stringing machine) and shouldn't reach shoppers.
          // Configs with no top-level string source keep their manual options as a fallback.
          const dropManualOptions = isStringGroup && topLevelStringProducts.length > 0;
          const manualOptions = (dropManualOptions ? [] : group.options)
            .filter((option) => !isExcluded(option.productId))
            .map((option) => {
            const productMeta = option.productId
              ? imageByProductId.get(option.productId)
              : undefined;
            const resolvedPrice =
              option.priceAdjust > 0
                ? option.priceAdjust
                : (productMeta?.price ?? option.priceAdjust);
            // Re-classify the string type from LIVE product metafields for manual string options
            // too — otherwise a string saved as a DB option keeps whatever `type` it had at
            // creation (usually the generic "String"), so the filter chips never match it even
            // though the product's "String Type" metafield is set.
            let metadata = option.metadata;
            if (isStringGroup && productMeta) {
              const resolvedType = resolveStringType(
                productMeta.title,
                productMeta.stringType,
                productMeta.stringType2,
                productMeta.tags,
                productMeta.productType,
              );
              metadata = JSON.stringify({ ...parseJson(option.metadata, {}), type: resolvedType });
            }
            return {
              ...option,
              metadata,
              imageUrl: productMeta?.imageUrl ?? option.imageUrl ?? null,
              previewLayer:
                productMeta?.imageUrl ?? option.previewLayer ?? option.imageUrl ?? null,
              variantId: option.variantId ?? productMeta?.variantId ?? null,
              priceAdjust: resolvedPrice,
            };
          });

          // Dedup against manual options AND across the merged sources — a product can be in
          // both the group's own collection and the top-level string collection, and would
          // otherwise appear twice. Add each id to `seen` as we accept it.
          const seen = new Set(
            manualOptions.map((o) => o.productId).filter(Boolean) as string[],
          );
          const dynamicOptions = [...collectionProducts, ...directProducts, ...extraStringProducts]
            .filter((product) => {
              if (isExcluded(product.id)) return false;
              if (seen.has(product.id)) return false;
              seen.add(product.id);
              return true;
            })
            .map((product, index) =>
              shopifyProductToOption(product, manualOptions.length + index, "shopify"),
            );

          return {
            ...group,
            options: [...manualOptions, ...dynamicOptions],
          };
        }),
      ),
    })),
  );

  // If no string group exists in the steps but a top-level string collection is configured,
  // inject a synthetic step+group so resolveStringCatalog can find the strings.
  const hasStringGroup = enrichedSteps
    .flatMap((s) => s.optionGroups)
    .some((g) => /string/i.test(g.name));

  const stepsWithStrings =
    topLevelStringProducts.length > 0 && !hasStringGroup
      ? [
          ...enrichedSteps,
          {
            id: "_string_step",
            configuratorId: configurator.id,
            title: "String Selection",
            description: null,
            stepType: "variant",
            sortOrder: enrichedSteps.length,
            isRequired: true,
            optionGroups: [
              {
                id: "_string_group",
                stepId: "_string_step",
                name: "Strings",
                displayType: "swatch",
                sortOrder: 0,
                isRequired: true,
                collectionIds: "[]",
                productIds: "[]",
                options: topLevelStringProducts.map((product, index) =>
                  shopifyProductToOption(product, index, "shopify"),
                ),
              },
            ],
          },
        ]
      : enrichedSteps;

  const resolvedAddons = (
    await Promise.all(
      configurator.addons
        .filter((a) => a.isActive)
        .map((addon) => resolveAddonProducts(admin, addon)),
    )
  ).flat();

  return {
    ...configurator,
    steps: stepsWithStrings,
    addons: resolvedAddons.map((addon) => ({
      id: addon.id,
      configuratorId: configurator.id,
      name: addon.name,
      description: addon.description,
      imageUrl: addon.imageUrl,
      price: addon.price,
      variantId: addon.variantId,
      productIds: "[]",
      collectionIds: "[]",
      maxQuantity: addon.maxQuantity,
      isActive: true,
      sortOrder: addon.sortOrder,
      metadata: JSON.stringify(addon.metadata),
    })),
  };
}
