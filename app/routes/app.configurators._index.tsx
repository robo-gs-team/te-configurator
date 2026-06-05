import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
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
import prisma from "~/db.server";
import { ensureShop, listConfigurators } from "~/lib/configurator.server";
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
    return redirect("/app/configurators");
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
                        {c.steps.length} steps · {c.addons.length} add-ons
                      </Text>
                    </BlockStack>
                    <InlineStack gap="200">
                      <Badge tone={c.isActive ? "success" : undefined}>
                        {c.isActive ? "Active" : "Inactive"}
                      </Badge>
                      <Button url={`/app/configurators/${c.id}`}>Edit</Button>
                      <Form method="post">
                        <input type="hidden" name="intent" value="delete" />
                        <input type="hidden" name="id" value={c.id} />
                        <Button
                          submit
                          tone="critical"
                          loading={navigation.state !== "idle"}
                        >
                          Delete
                        </Button>
                      </Form>
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
