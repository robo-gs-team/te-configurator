import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { Form, useActionData, useNavigation } from "@remix-run/react";
import {
  Banner,
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
  const stringProductIds = parseProductIdsField(String(form.get("stringProductIds") || ""));
  const basePrice = parseFloat(String(form.get("basePrice") || "0")) || 0;

  if (!name) return json({ error: "Name is required" }, { status: 400 });

  // No pre-seeded steps/option groups: a racquet collection + string collection + labor
  // product is enough for a working stringing configurator on its own (the string catalog
  // is auto-resolved from stringCollectionIds/stringProductIds — see
  // enrich-configurator.server.ts). Merchants only need "Steps & options" for extra
  // customization beyond standard stringing.
  const configurator = await prisma.configurator.create({
    data: {
      shopId: shop.id,
      name,
      description: description || null,
      productIds: JSON.stringify(productIds),
      collectionIds: JSON.stringify(collectionIds),
      stringCollectionIds: JSON.stringify(stringCollectionIds),
      stringProductIds: JSON.stringify(stringProductIds),
      basePrice,
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
  const [selectedStringProducts, setSelectedStringProducts] = useState<ProductSummary[]>([]);
  const [basePrice, setBasePrice] = useState("0");

  return (
    <Page
      title="Create configurator"
      backAction={{ content: "Configurators", url: "/app/configurators" }}
    >
      <Layout>
        <Layout.Section>
          <Banner tone="info" title="What is a configurator?">
            <p>
              A configurator is a stringing setup assigned to one or more <strong>racquet
              collections</strong> (or individual racquet products). Every racquet in that
              collection shows the Configure button using this configurator's string options,
              labor fee, and price. Create more than one if different racquet collections need
              different string options or labor pricing — e.g. one for performance racquets,
              another for junior racquets. Most shops only need one.
            </p>
          </Banner>
        </Layout.Section>
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
                  <ProductPicker
                    label="Individual string products"
                    helpText="These specific products also appear as string options, in addition to any string collections above."
                    name="stringProductIds"
                    selected={selectedStringProducts}
                    onChange={setSelectedStringProducts}
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
