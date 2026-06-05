import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
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
import { OptionAddForm } from "~/components/OptionAddForm";
import { RemoveItemButton } from "~/components/RemoveItemButton";
import { StepAddForm } from "~/components/StepAddForm";
import prisma from "~/db.server";
import {
  ensureShop,
  getConfiguratorById,
} from "~/lib/configurator.server";
import { parseJson } from "~/lib/configurator.types";
import { authenticate } from "~/shopify.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const configurator = await getConfiguratorById(params.id!);

  if (!configurator || configurator.shopId !== shop.id) {
    throw new Response("Not found", { status: 404 });
  }

  return json({ configurator });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
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
    const productIdsRaw = String(form.get("productIds") || "").trim();
    const basePrice = parseFloat(String(form.get("basePrice") || "0")) || 0;
    const isActive = form.get("isActive") === "on";

    const productIds = productIdsRaw
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);

    await prisma.configurator.update({
      where: { id: params.id },
      data: {
        name,
        description: description || null,
        productIds: JSON.stringify(productIds),
        basePrice,
        isActive,
      },
    });
    return json({ success: true });
  }

  if (intent === "add_rule") {
    await prisma.conditionalRule.create({
      data: {
        configuratorId: params.id!,
        name: String(form.get("ruleName") || "New rule"),
        conditionField: String(form.get("conditionField") || ""),
        conditionOp: "equals",
        conditionValue: String(form.get("conditionValue") || ""),
        actionType: String(form.get("actionType") || "price_adjust"),
        actionValue: JSON.stringify({
          amount: parseFloat(String(form.get("actionAmount") || "0")) || 0,
        }),
        actionTarget: String(form.get("actionTarget") || "") || null,
      },
    });
    return redirect(`/app/configurators/${params.id}`);
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

    return json({ success: true, intent });
  }

  if (intent === "add_addon") {
    const addonName = String(form.get("addonName") || "").trim();
    if (!addonName) {
      return json({ error: "Add-on name is required", intent }, { status: 400 });
    }

    await prisma.addon.create({
      data: {
        configuratorId: params.id!,
        name: addonName,
        price: parseFloat(String(form.get("addonPrice") || "0")) || 0,
        description: String(form.get("addonDescription") || "").trim() || null,
        variantId: String(form.get("addonVariantId") || "").trim() || null,
        sortOrder: existing.addons.length,
      },
    });

    return json({ success: true, intent });
  }

  if (intent === "add_option") {
    const stepId = String(form.get("stepId") || "").trim();
    const groupName = String(form.get("groupName") || "Options").trim();
    const optionLabel = String(form.get("optionLabel") || "").trim();
    const optionValue =
      String(form.get("optionValue") || "").trim() ||
      optionLabel.toLowerCase().replace(/\s+/g, "_");
    const priceAdjust = parseFloat(String(form.get("priceAdjust") || "0")) || 0;
    const colorHex = String(form.get("colorHex") || "").trim() || null;
    const imageUrl = String(form.get("imageUrl") || "").trim() || null;
    const variantId = String(form.get("variantId") || "").trim() || null;

    if (!stepId) {
      return json({ error: "Step is required", intent }, { status: 400 });
    }
    if (!optionLabel) {
      return json({ error: "Option label is required", intent }, { status: 400 });
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
        label: optionLabel,
        value: optionValue,
        priceAdjust,
        colorHex,
        imageUrl,
        previewLayer: imageUrl,
        variantId,
        sortOrder: optionCount,
        isDefault: optionCount === 0,
      },
    });

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
    return json({ success: true, intent });
  }

  return json({ ok: true });
};

export default function EditConfigurator() {
  const { configurator } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const productIds = parseJson<string[]>(configurator.productIds, []).join(", ");

  const [name, setName] = useState(configurator.name);
  const [description, setDescription] = useState(configurator.description ?? "");
  const [products, setProducts] = useState(productIds);
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
          <Card>
            <Form method="post">
              <input type="hidden" name="intent" value="update" />
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
                  <TextField
                    label="Product IDs"
                    name="productIds"
                    value={products}
                    onChange={setProducts}
                    helpText="Comma-separated Shopify product IDs"
                    autoComplete="off"
                  />
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
            </Form>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Steps & options
              </Text>
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
                          <BlockStack key={group.id} gap="100">
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
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneHalf">
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Add-ons
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Optional extras customers can add in the configurator popup (e.g. overgrip,
                dampener, rush stringing). Each add-on adds its price to the total and can be
                linked to a Shopify variant ID for checkout.
              </Text>
              {configurator.addons.length === 0 ? (
                <Text as="p" variant="bodySm" tone="subdued">
                  No add-ons yet. Skip this section if you only need string/options.
                </Text>
              ) : (
                configurator.addons.map((addon) => (
                  <InlineStack key={addon.id} align="space-between">
                    <Text as="span">{addon.name}</Text>
                    <Text as="span" tone="subdued">
                      +${addon.price.toFixed(2)}
                    </Text>
                  </InlineStack>
                ))
              )}
              <AddonAddForm />
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneHalf">
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Conditional rules
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Advanced logic: when a customer picks a certain option, you can adjust price,
                show/hide add-ons, or hide other options. Use option group IDs and option IDs from
                your database (shown in Shopify admin or browser dev tools). Most string setups do
                not need rules.
              </Text>
              {configurator.rules.length === 0 ? (
                <Text as="p" variant="bodySm" tone="subdued">
                  No rules yet.
                </Text>
              ) : (
                configurator.rules.map((rule) => (
                  <Text as="p" key={rule.id} variant="bodySm">
                    IF {rule.conditionField} {rule.conditionOp} &quot;{rule.conditionValue}
                    &quot; THEN {rule.actionType}
                    {rule.actionTarget ? ` → ${rule.actionTarget}` : ""}
                  </Text>
                ))
              )}
              <Form method="post">
                <input type="hidden" name="intent" value="add_rule" />
                <FormLayout>
                  <TextField label="Rule name" name="ruleName" autoComplete="off" />
                  <TextField
                    label="Condition field (option group ID)"
                    name="conditionField"
                    autoComplete="off"
                  />
                  <TextField label="Condition value (option ID)" name="conditionValue" autoComplete="off" />
                  <TextField
                    label="Action type"
                    name="actionType"
                    defaultValue="price_adjust"
                    helpText="price_adjust | show_addon | hide_addon | hide_option"
                    autoComplete="off"
                  />
                  <TextField label="Action target (addon/option ID)" name="actionTarget" autoComplete="off" />
                  <TextField label="Price amount" name="actionAmount" type="number" autoComplete="off" />
                </FormLayout>
                <Box paddingBlockStart="200">
                  <Button submit size="slim">
                    Add rule
                  </Button>
                </Box>
              </Form>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}