import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
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
import prisma from "~/db.server";
import { ensureShop } from "~/lib/configurator.server";
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
  const productIdsRaw = String(form.get("productIds") || "").trim();
  const basePrice = parseFloat(String(form.get("basePrice") || "0")) || 0;

  if (!name) return json({ error: "Name is required" }, { status: 400 });

  const productIds = productIdsRaw
    ? productIdsRaw.split(",").map((id) => id.trim()).filter(Boolean)
    : [];

  const configurator = await prisma.configurator.create({
    data: {
      shopId: shop.id,
      name,
      description: description || null,
      productIds: JSON.stringify(productIds),
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
  const [productIds, setProductIds] = useState("");
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
                  <TextField
                    label="Shopify Product IDs"
                    name="productIds"
                    value={productIds}
                    onChange={setProductIds}
                    helpText="Comma-separated product IDs this configurator applies to"
                    autoComplete="off"
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
