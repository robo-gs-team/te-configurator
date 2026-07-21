import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { Form, Link, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Badge,
  BlockStack,
  Button,
  Card,
  InlineStack,
  Layout,
  Page,
  Text,
} from "@shopify/polaris";
import { RemoveItemButton } from "~/components/RemoveItemButton";
import prisma from "~/db.server";
import { configuratorInclude, ensureShop, listConfigurators } from "~/lib/configurator.server";
import { authenticate } from "~/shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const configurators = await listConfigurators(shop.id);
  return json({ configurators });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "delete") {
    const id = String(form.get("id"));
    await prisma.configurator.deleteMany({ where: { id, shopId: shop.id } });
    // No redirect: the fetcher-based delete button revalidates this route's loader
    // in place, so the list updates instantly without a full page navigation.
    return json({ success: true });
  }

  if (intent === "duplicate") {
    const id = String(form.get("id"));
    const original = await prisma.configurator.findFirst({
      where: { id, shopId: shop.id },
      include: configuratorInclude,
    });
    if (!original) return json({ error: "Not found" }, { status: 404 });

    const duplicate = await prisma.configurator.create({
      data: {
        shopId: shop.id,
        name: `${original.name} (Copy)`,
        description: original.description,
        // Inactive by default, with racquet assignment cleared: forces a deliberate re-assignment
        // instead of silently inheriting the same racquets/collections as the original — which
        // would immediately create the exact "two configurators claim the same racquet" collision
        // the overlap warning above exists to catch.
        isActive: false,
        productIds: "[]",
        collectionIds: "[]",
        excludedProductIds: "[]",
        // String assignment carries over — it's what makes the duplicate immediately usable once
        // racquets are assigned, and strings can't collide the way racquet assignment can.
        stringCollectionIds: original.stringCollectionIds,
        stringProductIds: original.stringProductIds,
        // Out-of-stock overrides write real Shopify inventoryPolicy on save — never carry a live
        // Shopify-mutating flag onto a duplicate the merchant hasn't reviewed yet.
        allowOutOfStockRacquets: false,
        allowOutOfStockStrings: false,
        inventoryPolicyBackup: "{}",
        hideOutOfStockStrings: original.hideOutOfStockStrings,
        laborVariantId: original.laborVariantId,
        laborPrice: original.laborPrice,
        basePrice: original.basePrice,
        currency: original.currency,
        // No inherited snapshot — the duplicate builds its own the first time it's saved.
        enrichedSnapshot: null,
        snapshotUpdatedAt: null,
        steps: {
          create: original.steps.map((step) => ({
            title: step.title,
            description: step.description,
            stepType: step.stepType,
            sortOrder: step.sortOrder,
            isRequired: step.isRequired,
            optionGroups: {
              create: step.optionGroups.map((group) => ({
                name: group.name,
                displayType: group.displayType,
                collectionIds: group.collectionIds,
                productIds: group.productIds,
                sortOrder: group.sortOrder,
                isRequired: group.isRequired,
                options: {
                  create: group.options.map((option) => ({
                    label: option.label,
                    value: option.value,
                    imageUrl: option.imageUrl,
                    previewLayer: option.previewLayer,
                    priceAdjust: option.priceAdjust,
                    variantId: option.variantId,
                    productId: option.productId,
                    colorHex: option.colorHex,
                    sortOrder: option.sortOrder,
                    isDefault: option.isDefault,
                    metadata: option.metadata,
                  })),
                },
              })),
            },
          })),
        },
        addons: {
          create: original.addons.map((addon) => ({
            name: addon.name,
            description: addon.description,
            imageUrl: addon.imageUrl,
            price: addon.price,
            variantId: addon.variantId,
            productIds: addon.productIds,
            collectionIds: addon.collectionIds,
            maxQuantity: addon.maxQuantity,
            isActive: addon.isActive,
            sortOrder: addon.sortOrder,
            metadata: addon.metadata,
          })),
        },
        rules: {
          create: original.rules.map((rule) => ({
            name: rule.name,
            conditionField: rule.conditionField,
            conditionOp: rule.conditionOp,
            conditionValue: rule.conditionValue,
            actionType: rule.actionType,
            actionTarget: rule.actionTarget,
            actionValue: rule.actionValue,
            isActive: rule.isActive,
            sortOrder: rule.sortOrder,
          })),
        },
      } as Parameters<typeof prisma.configurator.create>[0]["data"],
    });

    // Full navigation (not a fetcher) straight to the new copy's edit page — duplicating is only
    // useful if you immediately go assign it racquets and review its settings.
    return redirect(`/app/configurators/${duplicate.id}`);
  }

  return json({ ok: true });
};

export default function ConfiguratorsList() {
  const { configurators } = useLoaderData<typeof loader>();
  const navigation = useNavigation();

  return (
    <Page
      title="Configurators"
      primaryAction={{ content: "Create", url: "/app/configurators/new" }}
      backAction={{ content: "Dashboard", url: "/app" }}
    >
      <Layout>
        <Layout.Section>
          {configurators.length === 0 ? (
            <Card>
              <BlockStack gap="300" inlineAlign="center">
                <Text as="p" tone="subdued">
                  No configurators created yet.
                </Text>
                <Button variant="primary" url="/app/configurators/new">
                  Create your first configurator
                </Button>
              </BlockStack>
            </Card>
          ) : (
            <BlockStack gap="300">
              {configurators.map((c) => (
                <Card key={c.id}>
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="100">
                      <Link to={`/app/configurators/${c.id}`}>
                        <Text as="span" variant="headingSm">
                          {c.name}
                        </Text>
                      </Link>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {c._count.steps} steps · {c._count.addons} add-ons
                      </Text>
                    </BlockStack>
                    <InlineStack gap="200">
                      <Badge tone={c.isActive ? "success" : undefined}>
                        {c.isActive ? "Active" : "Inactive"}
                      </Badge>
                      <Button url={`/app/configurators/${c.id}`}>Edit</Button>
                      <Form method="post" style={{ display: "inline" }}>
                        <input type="hidden" name="intent" value="duplicate" />
                        <input type="hidden" name="id" value={c.id} />
                        <Button
                          submit
                          loading={
                            navigation.state !== "idle" &&
                            navigation.formData?.get("intent") === "duplicate" &&
                            navigation.formData?.get("id") === c.id
                          }
                        >
                          Duplicate
                        </Button>
                      </Form>
                      <RemoveItemButton intent="delete" id={c.id} label="Delete" />
                    </InlineStack>
                  </InlineStack>
                </Card>
              ))}
            </BlockStack>
          )}
        </Layout.Section>
      </Layout>
    </Page>
  );
}
