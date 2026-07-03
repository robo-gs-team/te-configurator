import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { Form, Link, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  InlineGrid,
  InlineStack,
  Layout,
  Page,
  Text,
} from "@shopify/polaris";
import prisma from "~/db.server";
import {
  ensureShop,
  getAnalyticsSummary,
  getShopThemeSettings,
  listConfigurators,
} from "~/lib/configurator.server";
import {
  detectThemeButtonStatus,
} from "~/lib/theme-detection.server";
import { themeEditorEmbedUrl } from "~/lib/theme-embed";
import { refreshShopSnapshots } from "~/lib/snapshot.server";
import { getBuildInfo } from "~/lib/build-info.server";
import { authenticate } from "~/shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const [configurators, analytics, buttonStatus, theme] = await Promise.all([
    listConfigurators(shop.id),
    getAnalyticsSummary(shop.id, 30),
    detectThemeButtonStatus(admin, session.shop),
    getShopThemeSettings(shop.id),
  ]);

  return json({
    shop: session.shop,
    configurators,
    analytics,
    buttonStatus,
    theme,
    buildInfo: getBuildInfo(),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const form = await request.formData();
  const intent = String(form.get("intent"));

  if (intent === "toggle_button_enabled") {
    const nextEnabled = form.get("nextEnabled") === "true";
    await prisma.themeSetting.upsert({
      where: { shopId: shop.id },
      create: { shopId: shop.id, buttonEnabled: nextEnabled },
      update: { buttonEnabled: nextEnabled },
    });
    // Shop-wide kill switch: rebuild every snapshot (best-effort) so the change reaches
    // every product page immediately instead of waiting on the daily cron.
    await refreshShopSnapshots(admin, shop.id, session.shop);
    return json({ success: true });
  }

  return json({ ok: true });
};

export default function Dashboard() {
  const { shop, configurators, analytics, buttonStatus, theme, buildInfo } =
    useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isToggling =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "toggle_button_enabled";

  return (
    <Page
      title="Proto Switcher Configurator"
      subtitle="Premium product configurators for your store"
      primaryAction={{
        content: "Create configurator",
        url: "/app/configurators/new",
      }}
    >
      <Layout>
        <Layout.Section>
          <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
            <Card>
              <BlockStack gap="200">
                <Text as="p" variant="bodySm" tone="subdued">
                  Configurators
                </Text>
                <Text as="p" variant="headingXl">
                  {configurators.length}
                </Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="200">
                <Text as="p" variant="bodySm" tone="subdued">
                  Modal opens (30d)
                </Text>
                <Text as="p" variant="headingXl">
                  {analytics.counts.modal_open ?? 0}
                </Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="200">
                <Text as="p" variant="bodySm" tone="subdued">
                  Add to cart (30d)
                </Text>
                <Text as="p" variant="headingXl">
                  {analytics.counts.add_to_cart ?? 0}
                </Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="200">
                <Text as="p" variant="bodySm" tone="subdued">
                  Button status
                </Text>
                <Badge
                  tone={
                    buttonStatus.detail === "active"
                      ? "success"
                      : buttonStatus.detail === "embed_missing"
                        ? "critical"
                        : "warning"
                  }
                >
                  {buttonStatus.detail === "active"
                    ? `Live · ${buttonStatus.themeName}`
                    : buttonStatus.detail === "embed_missing"
                      ? "App embed not installed"
                      : "Unknown"}
                </Badge>
                {buttonStatus.detail !== "active" && buttonStatus.themeId && (
                  <Button
                    variant="plain"
                    url={themeEditorEmbedUrl(shop, buttonStatus.themeId)}
                    target="_blank"
                    size="slim"
                  >
                    Enable in Theme Editor →
                  </Button>
                )}
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="200">
                <Text as="p" variant="bodySm" tone="subdued">
                  Storefront button (all products)
                </Text>
                <Badge tone={theme.buttonEnabled ? "success" : "critical"}>
                  {theme.buttonEnabled ? "On" : "Off — shop-wide"}
                </Badge>
                <Form method="post">
                  <input type="hidden" name="intent" value="toggle_button_enabled" />
                  <input
                    type="hidden"
                    name="nextEnabled"
                    value={theme.buttonEnabled ? "false" : "true"}
                  />
                  <Button
                    submit
                    size="slim"
                    tone={theme.buttonEnabled ? "critical" : "success"}
                    loading={isToggling}
                  >
                    {theme.buttonEnabled ? "Turn off everywhere" : "Turn back on"}
                  </Button>
                </Form>
              </BlockStack>
            </Card>
          </InlineGrid>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd">
                  Recent configurators
                </Text>
                <Button url="/app/configurators">View all</Button>
              </InlineStack>
              {configurators.length === 0 ? (
                <Box padding="400">
                  <BlockStack gap="300" inlineAlign="center">
                    <Text as="p" tone="subdued">
                      No configurators yet. Create your first one to get started.
                    </Text>
                    <Button variant="primary" url="/app/configurators/new">
                      Create configurator
                    </Button>
                  </BlockStack>
                </Box>
              ) : (
                (configurators as Array<{ id: string; name: string; _count: { steps: number; addons: number }; isActive: boolean }>).slice(0, 5).map((c) => (
                  <InlineStack key={c.id} align="space-between" blockAlign="center">
                    <BlockStack gap="100">
                      <Link to={`/app/configurators/${c.id}`}>
                        <Text as="span" variant="bodyMd" fontWeight="semibold">
                          {c.name}
                        </Text>
                      </Link>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {c._count.steps} steps · {c._count.addons} add-ons
                      </Text>
                    </BlockStack>
                    <Badge tone={c.isActive ? "success" : undefined}>
                      {c.isActive ? "Active" : "Draft"}
                    </Badge>
                  </InlineStack>
                ))
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Setup checklist
              </Text>
              <BlockStack gap="200">
                <Text as="p" variant="bodySm">
                  1. Create a configurator and select your racket products
                </Text>
                <Text as="p" variant="bodySm">
                  2. Theme Editor → App embeds → enable Proto Configurator
                </Text>
                <Text as="p" variant="bodySm">
                  3. Product page → add Configurator Button block (stringing dropdown + Configure)
                </Text>
              </BlockStack>
              <Button url="/app/settings">Theme settings</Button>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Box paddingBlockStart="200">
            <Text as="p" variant="bodySm" tone="subdued" alignment="center">
              Build{" "}
              {buildInfo.commitUrl ? (
                <a href={buildInfo.commitUrl} target="_blank" rel="noopener noreferrer">
                  {buildInfo.shortSha}
                </a>
              ) : (
                buildInfo.shortSha
              )}
              {" · server started "}
              {buildInfo.serverStartedAt.replace("T", " ").slice(0, 16)} UTC
            </Text>
          </Box>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
