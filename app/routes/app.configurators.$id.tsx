import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { Form, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Checkbox,
  FormLayout,
  InlineStack,
  Layout,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";
import { useState } from "react";
import { AddonAddForm } from "~/components/AddonAddForm";
import { CollectionPicker } from "~/components/CollectionPicker";
import { LaborProductPicker, type LaborProductSelection } from "~/components/LaborProductPicker";
import { OptionAddForm } from "~/components/OptionAddForm";
import { OptionGroupSourcePicker } from "~/components/OptionGroupSourcePicker";
import { ProductPicker } from "~/components/ProductPicker";
import { RemoveItemButton } from "~/components/RemoveItemButton";
import { StepAddForm } from "~/components/StepAddForm";
import prisma from "~/db.server";
import {
  ensureShop,
  getConfiguratorById,
} from "~/lib/configurator.server";
import { refreshConfiguratorSnapshot } from "~/lib/snapshot.server";
import { ensureTensionMetafieldDefinitions } from "~/lib/product-metafields.server";
import { parseJson } from "~/lib/configurator.types";
import { parseCollectionIdsField } from "~/lib/collection-id";
import { parseProductIdsField } from "~/lib/product-id";
import { getCollectionsByIds } from "~/lib/shopify-collections.server";
import { getProductsByIds } from "~/lib/shopify-products.server";
import { authenticate } from "~/shopify.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const configurator = await getConfiguratorById(params.id!);

  if (!configurator || configurator.shopId !== shop.id) {
    throw new Response("Not found", { status: 404 });
  }

  const collectionIds = parseJson<string[]>(configurator.collectionIds, []);
  const stringCollectionIds = parseJson<string[]>(
    (configurator as typeof configurator & { stringCollectionIds?: string }).stringCollectionIds ?? "[]",
    [],
  );
  const stringProductIds = parseJson<string[]>(
    (configurator as typeof configurator & { stringProductIds?: string }).stringProductIds ?? "[]",
    [],
  );
  // Collect every option group's collection/product IDs up front so we can fetch them in
  // TWO batched Shopify calls total (getCollectionsByIds / getProductsByIds both accept
  // arbitrarily many IDs via nodes(ids:)), instead of 2 serial calls PER group.
  const groupCollectionIds: Record<string, string[]> = {};
  const groupProductIds: Record<string, string[]> = {};
  const allGroupCollectionIds = new Set<string>();
  const allGroupProductIds = new Set<string>();
  for (const step of configurator.steps) {
    for (const group of step.optionGroups) {
      const cids = parseJson<string[]>(group.collectionIds ?? "[]", []);
      const pids = parseJson<string[]>(group.productIds ?? "[]", []);
      groupCollectionIds[group.id] = cids;
      groupProductIds[group.id] = pids;
      cids.forEach((id) => allGroupCollectionIds.add(id));
      pids.forEach((id) => allGroupProductIds.add(id));
    }
  }

  const [
    collections,
    stringCollections,
    products,
    stringProducts,
    ,
    allGroupCollections,
    allGroupProducts,
  ] = await Promise.all([
    getCollectionsByIds(admin, collectionIds),
    getCollectionsByIds(admin, stringCollectionIds),
    getProductsByIds(admin, parseJson<string[]>(configurator.productIds, [])),
    getProductsByIds(admin, stringProductIds),
    // Idempotent — checks existence first (cached per shop after the first call), only creates
    // on first-ever call. Registers the per-racquet tension metafield definitions so they show
    // up in Shopify's native "Metafields" section on every product page.
    ensureTensionMetafieldDefinitions(admin, session.shop),
    allGroupCollectionIds.size > 0
      ? getCollectionsByIds(admin, [...allGroupCollectionIds])
      : Promise.resolve([]),
    allGroupProductIds.size > 0
      ? getProductsByIds(admin, [...allGroupProductIds])
      : Promise.resolve([]),
  ]);

  // Partition the batched results back to each group in memory.
  const collectionById = new Map(allGroupCollections.map((c) => [c.id, c]));
  const productById = new Map(allGroupProducts.map((p) => [p.id, p]));
  const groupCollections: Record<string, Awaited<ReturnType<typeof getCollectionsByIds>>> = {};
  const groupProducts: Record<string, Awaited<ReturnType<typeof getProductsByIds>>> = {};
  for (const step of configurator.steps) {
    for (const group of step.optionGroups) {
      groupCollections[group.id] = groupCollectionIds[group.id]
        .map((id) => collectionById.get(id))
        .filter((c): c is NonNullable<typeof c> => Boolean(c));
      groupProducts[group.id] = groupProductIds[group.id]
        .map((id) => productById.get(id))
        .filter((p): p is NonNullable<typeof p> => Boolean(p));
    }
  }

  const labor: LaborProductSelection | null = configurator.laborVariantId
    ? {
        variantId: configurator.laborVariantId,
        title: "Stringing labor",
        price: configurator.laborPrice,
      }
    : null;

  return json({
    configurator,
    collections,
    stringCollections,
    products,
    stringProducts,
    groupCollections,
    groupProducts,
    labor,
  });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const form = await request.formData();
  const intent = String(form.get("intent"));

  const existing = await getConfiguratorById(params.id!);
  if (!existing || existing.shopId !== shop.id) {
    throw new Response("Not found", { status: 404 });
  }

  if (intent === "update") {
    const name = String(form.get("name") || "").trim();
    const description = String(form.get("description") || "").trim();
    const collectionIds = parseCollectionIdsField(String(form.get("collectionIds") || ""));
    const stringCollectionIds = parseCollectionIdsField(String(form.get("stringCollectionIds") || ""));
    const productIds = parseProductIdsField(String(form.get("productIds") || ""));
    const stringProductIds = parseProductIdsField(String(form.get("stringProductIds") || ""));
    const laborVariantId = String(form.get("laborVariantId") || "").trim() || null;
    const laborPrice = parseFloat(String(form.get("laborPrice") || "0")) || 0;
    const basePrice = parseFloat(String(form.get("basePrice") || "0")) || 0;
    const isActive = form.get("isActive") === "on";

    await prisma.configurator.update({
      where: { id: params.id },
      data: {
        name,
        description: description || null,
        productIds: JSON.stringify(productIds),
        collectionIds: JSON.stringify(collectionIds),
        stringCollectionIds: JSON.stringify(stringCollectionIds),
        stringProductIds: JSON.stringify(stringProductIds),
        laborVariantId,
        laborPrice,
        basePrice,
        isActive,
      },
    });

    // One save covers everything on the page: general settings above, plus every option
    // group's product sources below (submitted as groupCollections_<id> / groupProducts_<id>
    // hidden fields inside this same form — see OptionGroupSourcePicker).
    const allGroups = existing.steps.flatMap((step) => step.optionGroups);
    await Promise.all(
      allGroups.map((group) => {
        const groupCollectionIds = form.get(`groupCollections_${group.id}`);
        const groupProductIds = form.get(`groupProducts_${group.id}`);
        if (groupCollectionIds === null && groupProductIds === null) return null;
        return prisma.optionGroup.update({
          where: { id: group.id },
          data: {
            collectionIds: JSON.stringify(
              parseCollectionIdsField(String(groupCollectionIds ?? "[]")),
            ),
            productIds: JSON.stringify(
              parseProductIdsField(String(groupProductIds ?? "[]")),
            ),
          },
        });
      }),
    );

    // B1: rebuild the enriched snapshot (best-effort) + bust the cache so shoppers see the change
    await refreshConfiguratorSnapshot(admin, params.id!, shop.id, session.shop);
    return json({ success: true });
  }

  if (intent === "add_step") {
    const stepTitle = String(form.get("stepTitle") || "").trim();
    if (!stepTitle) {
      return json({ error: "Step title is required", intent }, { status: 400 });
    }

    const stepCount = await prisma.configuratorStep.count({
      where: { configuratorId: params.id },
    });

    await prisma.configuratorStep.create({
      data: {
        configuratorId: params.id!,
        title: stepTitle,
        stepType: "variant",
        sortOrder: stepCount,
      },
    });

    await refreshConfiguratorSnapshot(admin, params.id!, shop.id, session.shop);
    return json({ success: true, intent });
  }

  if (intent === "add_addon") {
    const addonSource = String(form.get("addonSource") || "product");
    const addonName = String(form.get("addonName") || "").trim();
    const productIds = parseProductIdsField(String(form.get("productIds") || ""));
    const collectionIds = parseCollectionIdsField(String(form.get("collectionIds") || ""));

    if (addonSource === "product" && productIds.length === 0) {
      return json({ error: "Select at least one product", intent }, { status: 400 });
    }
    if (addonSource === "collection" && collectionIds.length === 0) {
      return json({ error: "Select at least one collection", intent }, { status: 400 });
    }

    await prisma.addon.create({
      data: {
        configuratorId: params.id!,
        name: addonName || "Add-on",
        price: parseFloat(String(form.get("addonPrice") || "0")) || 0,
        description: String(form.get("addonDescription") || "").trim() || null,
        productIds: JSON.stringify(addonSource === "product" ? productIds : []),
        collectionIds: JSON.stringify(addonSource === "collection" ? collectionIds : []),
        sortOrder: existing.addons.length,
      },
    });

    await refreshConfiguratorSnapshot(admin, params.id!, shop.id, session.shop);
    return json({ success: true, intent });
  }

  if (intent === "add_option") {
    const stepId = String(form.get("stepId") || "").trim();
    const groupName = String(form.get("groupName") || "Options").trim();
    const optionLabel = String(form.get("optionLabel") || "").trim();
    const optionValue =
      String(form.get("optionValue") || "").trim() ||
      optionLabel.toLowerCase().replace(/\s+/g, "_");
    const colorHex = String(form.get("colorHex") || "").trim() || null;
    const productId = String(form.get("productId") || "").trim() || null;
    const priceAdjust = parseFloat(String(form.get("priceAdjust") || "0")) || 0;

    if (!stepId) {
      return json({ error: "Step is required", intent }, { status: 400 });
    }
    if (!optionLabel && !productId) {
      return json({ error: "Option label or product is required", intent }, { status: 400 });
    }

    const step = await prisma.configuratorStep.findFirst({
      where: { id: stepId, configuratorId: params.id },
    });
    if (!step) {
      return json({ error: "Step not found", intent }, { status: 404 });
    }
    if (step.stepType !== "variant" && step.stepType !== "options") {
      return json(
        {
          error: `Cannot add options to a "${step.stepType}" step. Add a variant step instead.`,
          intent,
        },
        { status: 400 },
      );
    }

    let group = await prisma.optionGroup.findFirst({
      where: { stepId, name: groupName },
    });

    if (!group) {
      const groupCount = await prisma.optionGroup.count({ where: { stepId } });
      group = await prisma.optionGroup.create({
        data: {
          stepId,
          name: groupName,
          displayType: "swatch",
          sortOrder: groupCount,
        },
      });
    }

    const optionCount = await prisma.option.count({
      where: { optionGroupId: group.id },
    });

    await prisma.option.create({
      data: {
        optionGroupId: group.id,
        label: optionLabel || "Option",
        value: optionValue,
        priceAdjust,
        colorHex,
        imageUrl: null,
        previewLayer: null,
        variantId: null,
        productId,
        sortOrder: optionCount,
        isDefault: optionCount === 0,
      },
    });

    await refreshConfiguratorSnapshot(admin, params.id!, shop.id, session.shop);
    return json({ success: true, intent });
  }

  if (intent === "delete_step") {
    const stepId = String(form.get("stepId") || "").trim();
    const step = await prisma.configuratorStep.findFirst({
      where: { id: stepId, configuratorId: params.id },
    });
    if (!step) {
      return json({ error: "Step not found", intent }, { status: 404 });
    }
    await prisma.configuratorStep.delete({ where: { id: stepId } });
    await refreshConfiguratorSnapshot(admin, params.id!, shop.id, session.shop);
    return json({ success: true, intent });
  }

  return json({ ok: true });
};

export default function EditConfigurator() {
  const {
    configurator,
    collections,
    stringCollections,
    products,
    stringProducts,
    groupCollections,
    groupProducts,
    labor,
  } = useLoaderData<typeof loader>();
  const navigation = useNavigation();

  const [name, setName] = useState(configurator.name);
  const [description, setDescription] = useState(configurator.description ?? "");
  const [selectedCollections, setSelectedCollections] = useState(collections);
  const [selectedStringCollections, setSelectedStringCollections] = useState(stringCollections);
  const [selectedProducts, setSelectedProducts] = useState(products);
  const [selectedStringProducts, setSelectedStringProducts] = useState(stringProducts);
  const [laborProduct, setLaborProduct] = useState<LaborProductSelection | null>(labor);
  const [basePrice, setBasePrice] = useState(String(configurator.basePrice));
  const [isActive, setIsActive] = useState(configurator.isActive);

  return (
    <Page
      title={configurator.name}
      backAction={{ content: "Configurators", url: "/app/configurators" }}
      titleMetadata={
        <Badge tone={configurator.isActive ? "success" : undefined}>
          {configurator.isActive ? "Active" : "Inactive"}
        </Badge>
      }
    >
      <Layout>
        {!configurator.isActive && (
          <Layout.Section>
            <Banner tone="warning" title="Configurator is inactive">
              <p>
                The storefront will not load this configurator until <strong>Active</strong> is
                enabled and you click <strong>Save changes</strong> below.
              </p>
            </Banner>
          </Layout.Section>
        )}
        <Layout.Section>
          <Form method="post">
            <input type="hidden" name="intent" value="update" />
            <BlockStack gap="400">
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  General settings
                </Text>
                <FormLayout>
                  <TextField label="Name" name="name" value={name} onChange={setName} autoComplete="off" />
                  <TextField
                    label="Description"
                    name="description"
                    value={description}
                    onChange={setDescription}
                    multiline={2}
                    autoComplete="off"
                  />
                  <CollectionPicker
                    label="Racquet collections"
                    helpText="Products in these collections will show the Configure button."
                    selected={selectedCollections}
                    onChange={setSelectedCollections}
                  />
                  <ProductPicker
                    label="Individual racquet products"
                    helpText="These specific products will also show the Configure button."
                    selected={selectedProducts}
                    onChange={setSelectedProducts}
                  />
                  <Banner tone="info" title="Set stringing tension per racquet">
                    <BlockStack gap="150">
                      <p>
                        Each racquet has its own recommended tension. Open any racquet product in
                        Shopify admin → <strong>Metafields</strong>, and fill in the three
                        &quot;Stringing tension&quot; fields (Min / Max / Recommended, lbs).
                        Racquets left blank use a default range of 46–55 lbs.
                      </p>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Technical field names, if you need to match them exactly:{" "}
                        <code>te_stringing.tension_min</code>,{" "}
                        <code>te_stringing.tension_max</code>,{" "}
                        <code>te_stringing.tension_recommended</code>.
                      </Text>
                    </BlockStack>
                  </Banner>
                  <CollectionPicker
                    label="String collections"
                    helpText="Products in these collections appear as string options in the configurator."
                    name="stringCollectionIds"
                    selected={selectedStringCollections}
                    onChange={setSelectedStringCollections}
                  />
                  <ProductPicker
                    label="Individual string products"
                    helpText="These specific products also appear as string options, in addition to any string collections above."
                    name="stringProductIds"
                    selected={selectedStringProducts}
                    onChange={setSelectedStringProducts}
                  />
                  <LaborProductPicker selected={laborProduct} onChange={setLaborProduct} />
                  <TextField
                    label="Base price"
                    name="basePrice"
                    value={basePrice}
                    onChange={setBasePrice}
                    type="number"
                    prefix="$"
                    autoComplete="off"
                  />
                  <Checkbox label="Active" checked={isActive} onChange={setIsActive} />
                  {isActive ? (
                    <input type="hidden" name="isActive" value="on" />
                  ) : null}
                </FormLayout>
                <Button submit variant="primary" loading={navigation.state !== "idle"}>
                  Save changes
                </Button>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Steps & options
              </Text>
              <Banner tone="info">
                <p>
                  Most stringing configurators don't need this section — racquets and strings
                  are already fully configured above. Only add a step here if you need string
                  options beyond the collections/products above; other step or option types
                  won't appear to shoppers, since stringing configurators use a dedicated
                  interface.
                </p>
              </Banner>
              {configurator.steps.length === 0 ? (
                <Text as="p" tone="subdued">
                  No steps yet. Add a step below, then add options to it.
                </Text>
              ) : (
                configurator.steps.map((step) => (
                  <Box
                    key={step.id}
                    padding="400"
                    background="bg-surface-secondary"
                    borderRadius="200"
                  >
                    <BlockStack gap="300">
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="h3" variant="headingSm">
                          {step.title}{" "}
                          <Badge>{step.stepType}</Badge>
                        </Text>
                        <RemoveItemButton
                          intent="delete_step"
                          id={step.id}
                          idField="stepId"
                          label="Remove step"
                        />
                      </InlineStack>
                      {step.optionGroups.length === 0 ? (
                        <Text as="p" variant="bodySm" tone="subdued">
                          No option groups yet.
                        </Text>
                      ) : (
                        step.optionGroups.map((group) => (
                          <BlockStack key={group.id} gap="200">
                            <Text as="p" variant="bodySm" fontWeight="semibold">
                              {group.name} ({group.displayType})
                            </Text>
                            <InlineStack gap="200" wrap>
                              {group.options.map((opt) => (
                                <Badge key={opt.id}>
                                  {opt.label}
                                  {opt.priceAdjust ? ` (+$${opt.priceAdjust})` : ""}
                                </Badge>
                              ))}
                            </InlineStack>
                            {(step.stepType === "variant" || step.stepType === "options") ? (
                              <OptionGroupSourcePicker
                                groupId={group.id}
                                groupName={group.name}
                                initialCollections={groupCollections[group.id] ?? []}
                                initialProducts={groupProducts[group.id] ?? []}
                              />
                            ) : null}
                          </BlockStack>
                        ))
                      )}
                      {step.stepType === "variant" || step.stepType === "options" ? (
                        <OptionAddForm stepId={step.id} />
                      ) : (
                        <Text as="p" variant="bodySm" tone="subdued">
                          Options can only be added to variant or options steps (not{" "}
                          {step.stepType}).
                        </Text>
                      )}
                    </BlockStack>
                  </Box>
                ))
              )}
              <Box paddingBlockStart="200">
                <Text as="h3" variant="headingSm">
                  Add step
                </Text>
                <Box paddingBlockStart="200">
                  <StepAddForm />
                </Box>
              </Box>
              <Button submit variant="primary" loading={navigation.state !== "idle"}>
                Save changes
              </Button>
              </BlockStack>
            </Card>
            </BlockStack>
          </Form>
        </Layout.Section>

        <Layout.Section variant="oneHalf">
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Add-ons
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Optional extras the shopper can add alongside their racquet + stringing —
                e.g. extra grip tape, a vibration dampener, or a racquet bag. Link a Shopify
                product or collection and the image, price, and variant are pulled in
                automatically (or set a manual price). Shown as cards in the configurator popup,
                right before Add to Cart; shoppers can bump the quantity up if you allow more
                than one.
              </Text>
              <Box
                padding="300"
                background="bg-surface-secondary"
                borderRadius="200"
                borderStyle="dashed"
                borderWidth="025"
              >
                <BlockStack gap="150">
                  <Text as="p" variant="bodySm" tone="subdued" fontWeight="medium">
                    Preview — what shoppers see
                  </Text>
                  <InlineStack gap="300" blockAlign="center">
                    <Box
                      background="bg-surface-tertiary"
                      borderRadius="200"
                      minWidth="48px"
                      minHeight="48px"
                    />
                    <BlockStack gap="050">
                      <Text as="span" variant="bodySm" fontWeight="semibold">
                        Vibration Dampener
                      </Text>
                      <Text as="span" variant="bodySm" tone="subdued">
                        +$4.99
                      </Text>
                    </BlockStack>
                    <Box paddingInlineStart="400">
                      <InlineStack gap="150" blockAlign="center">
                        <Badge>−</Badge>
                        <Text as="span" variant="bodySm">1</Text>
                        <Badge>+</Badge>
                      </InlineStack>
                    </Box>
                  </InlineStack>
                </BlockStack>
              </Box>
              {configurator.addons.length === 0 ? (
                <Text as="p" variant="bodySm" tone="subdued">
                  No add-ons yet. Skip this section if you only need string/options.
                </Text>
              ) : (
                configurator.addons.map((addon) => {
                  const pids = parseJson<string[]>(addon.productIds ?? "[]", []);
                  const cids = parseJson<string[]>(addon.collectionIds ?? "[]", []);
                  const source =
                    pids.length > 0
                      ? `${pids.length} product(s)`
                      : cids.length > 0
                        ? `${cids.length} collection(s)`
                        : addon.variantId
                          ? "manual variant"
                          : "unlinked";
                  return (
                    <InlineStack key={addon.id} align="space-between">
                      <Text as="span">
                        {addon.name}{" "}
                        <Text as="span" tone="subdued">
                          ({source})
                        </Text>
                      </Text>
                      <Text as="span" tone="subdued">
                        {addon.price > 0 ? `+$${addon.price.toFixed(2)}` : "Shopify price"}
                      </Text>
                    </InlineStack>
                  );
                })
              )}
              <AddonAddForm />
            </BlockStack>
          </Card>
        </Layout.Section>

        {configurator.rules.length > 0 && (
          <Layout.Section variant="oneHalf">
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Conditional rules
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Advanced logic configured on this configurator. New rules can no longer be
                  added here — most stringing setups don't need them, and this simple list view
                  is read-only.
                </Text>
                {configurator.rules.map((rule) => (
                  <Text as="p" key={rule.id} variant="bodySm">
                    IF {rule.conditionField} {rule.conditionOp} &quot;{rule.conditionValue}
                    &quot; THEN {rule.actionType}
                    {rule.actionTarget ? ` → ${rule.actionTarget}` : ""}
                  </Text>
                ))}
              </BlockStack>
            </Card>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}