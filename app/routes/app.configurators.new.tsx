import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { Form, useActionData, useNavigation } from "@remix-run/react";
import {
  BlockStack,
  Button,
  Card,
  FormLayout,
  Layout,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";
import { useState } from "react";
import { CollectionPicker } from "~/components/CollectionPicker";
import { ProductPicker } from "~/components/ProductPicker";
import prisma from "~/db.server";
import { ensureShop } from "~/lib/configurator.server";
import { parseCollectionIdsField } from "~/lib/collection-id";
import { parseProductIdsField } from "~/lib/product-id";
import type { CollectionSummary } from "~/lib/shopify-collections.server";
import type { ProductSummary } from "~/lib/shopify-products.server";
import { authenticate } from "~/shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return json({});
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const form = await request.formData();

  const name = String(form.get("name") || "").trim();
  const description = String(form.get("description") || "").trim();
  const collectionIds = parseCollectionIdsField(String(form.get("collectionIds") || ""));
  const stringCollectionIds = parseCollectionIdsField(String(form.get("stringCollectionIds") || ""));
  const productIds = parseProductIdsField(String(form.get("productIds") || ""));
  const basePrice = parseFloat(String(form.get("basePrice") || "0")) || 0;

  if (!name) return json({ error: "Name is required" }, { status: 400 });

  const configurator = await (prisma.configurator.create as Function)({
    data: {
      shopId: shop.id,
      name,
      description: description || null,
      productIds: JSON.stringify(productIds),
      collectionIds: JSON.stringify(collectionIds),
      stringCollectionIds: JSON.stringify(stringCollectionIds),
      basePrice,
      steps: {
        create: [
          {
            title: "Choose Your Options",
            stepType: "variant",
            sortOrder: 0,
            optionGroups: {
              create: [
                {
                  name: "Color",
                  displayType: "swatch",
                  sortOrder: 0,
                  options: {
                    create: [
                      {
                        label: "Black",
                        value: "black",
                        colorHex: "#111827",
                        sortOrder: 0,
                        isDefault: true,
                      },
                      {
                        label: "White",
                        value: "white",
                        colorHex: "#f9fafb",
                        sortOrder: 1,
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
  });

  return redirect(`/app/configurators/${configurator.id}`);
};

export default function NewConfigurator() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedCollections, setSelectedCollections] = useState<CollectionSummary[]>([]);
  const [selectedStringCollections, setSelectedStringCollections] = useState<CollectionSummary[]>([]);
  const [selectedProducts, setSelectedProducts] = useState<ProductSummary[]>([]);
  const [basePrice, setBasePrice] = useState("0");

  return (
    <Page
      title="Create configurator"
      backAction={{ content: "Configurators", url: "/app/configurators" }}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <Form method="post">
              <BlockStack gap="400">
                {actionData?.error && (
                  <Text as="p" tone="critical">
                    {actionData.error}
                  </Text>
                )}
                <FormLayout>
                  <TextField
                    label="Name"
                    name="name"
                    value={name}
                    onChange={setName}
                    autoComplete="off"
                    requiredIndicator
                  />
                  <TextField
                    label="Description"
                    name="description"
                    value={description}
                    onChange={setDescription}
                    autoComplete="off"
                    multiline={3}
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
                  <CollectionPicker
                    label="String collections"
                    helpText="Products in these collections appear as string options in the configurator."
                    name="stringCollectionIds"
                    selected={selectedStringCollections}
                    onChange={setSelectedStringCollections}
                  />
                  <TextField
                    label="Base price"
                    name="basePrice"
                    type="number"
                    value={basePrice}
                    onChange={setBasePrice}
                    autoComplete="off"
                    prefix="$"
                  />
                </FormLayout>
                <Button
                  submit
                  variant="primary"
                  loading={navigation.state !== "idle"}
                >
                  Create configurator
                </Button>
              </BlockStack>
            </Form>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
