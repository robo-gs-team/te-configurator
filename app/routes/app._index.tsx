import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { useState } from "react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  InlineGrid,
  InlineStack,
  Layout,
  Page,
  Text,
  Tooltip,
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
import { getVersionInfo } from "~/lib/version.server";
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
    versions: getVersionInfo(),
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

/** "Jul 23, 2026, 3:16 PM" — matches the formatting used on the Settings version card. */
function formatVersionDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(d);
}

export default function Dashboard() {
  const { shop, configurators, analytics, buttonStatus, theme, versions } =
    useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const actionData = useActionData<typeof action>();
  const [confirmingOff, setConfirmingOff] = useState(false);
  const isToggling =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "toggle_button_enabled";
  // The badge itself flips On/Off after a toggle; this message just confirms it explicitly.
  const toggleJustSucceeded =
    navigation.state === "idle" && Boolean((actionData as { success?: boolean } | undefined)?.success);

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
          <Banner tone="info">
            <InlineStack align="space-between" blockAlign="center" wrap>
              <InlineStack gap="400" blockAlign="center" wrap>
                <InlineStack gap="150" blockAlign="center">
                  <Badge tone="success">Stable · live theme</Badge>
                  <Text as="span" variant="headingSm">
                    {versions.stable.version}
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {versions.stable.label} · promoted {formatVersionDate(versions.stable.promotedAt)}
                  </Text>
                </InlineStack>
                <InlineStack gap="150" blockAlign="center">
                  <Badge tone="attention">Beta · draft theme</Badge>
                  <Text as="span" variant="bodySm" fontWeight="semibold">
                    {versions.beta.commit ? versions.beta.commit.slice(0, 8) : "unknown"}
                  </Text>
                  {versions.beta.message && (
                    <Text as="span" variant="bodySm" tone="subdued">
                      "{versions.beta.message}"
                    </Text>
                  )}
                </InlineStack>
              </InlineStack>
              <Button url="/app/settings" size="slim">
                Version details
              </Button>
            </InlineStack>
          </Banner>
        </Layout.Section>

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
                {buttonStatus.detail === "unknown" && buttonStatus.reason && (
                  <Text as="p" variant="bodySm" tone="subdued">
                    {buttonStatus.reason === "missing_theme_scope"
                      ? "The app can't read your theme (missing theme permission). Reinstall / reopen the app to grant it — this badge is informational and doesn't affect the storefront."
                      : buttonStatus.reason === "no_published_theme"
                        ? "No published theme found for this store."
                        : buttonStatus.reason === "settings_unreadable"
                          ? "Found your published theme but couldn't read its settings."
                          : "Couldn't reach Shopify to check the theme — try again shortly."}
                  </Text>
                )}
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
                <InlineStack gap="100" blockAlign="center">
                  <Text as="p" variant="bodySm" tone="subdued">
                    Storefront button (all products)
                  </Text>
                  <Tooltip content="Master on/off switch for the Configure button across EVERY product. Turning it off hides the button shop-wide within a minute — even on themes where the app embed is enabled — and restores each theme's normal Add to Cart. Independent of individual configurators.">
                    <Text as="span" tone="subdued">
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: 15,
                          height: 15,
                          borderRadius: "50%",
                          border: "1px solid currentColor",
                          fontSize: 10,
                          cursor: "help",
                        }}
                      >
                        ?
                      </span>
                    </Text>
                  </Tooltip>
                </InlineStack>
                <Badge tone={theme.buttonEnabled ? "success" : "critical"}>
                  {theme.buttonEnabled ? "On" : "Off — shop-wide"}
                </Badge>
                <Text as="p" variant="bodySm" tone="subdued">
                  {theme.buttonEnabled
                    ? "The Configure button can appear on product pages (where the app embed is enabled)."
                    : "The Configure button is hidden on all products, even where the app embed is on."}
                </Text>
                {toggleJustSucceeded && (
                  <Banner tone={theme.buttonEnabled ? "success" : "warning"}>
                    <p>
                      {theme.buttonEnabled
                        ? "Configure button turned back on. It may take up to a minute to appear on the storefront."
                        : "Configure button turned off across all products. It may take up to a minute to disappear from the storefront."}
                    </p>
                  </Banner>
                )}
                <Form method="post">
                  <input type="hidden" name="intent" value="toggle_button_enabled" />
                  <input
                    type="hidden"
                    name="nextEnabled"
                    value={theme.buttonEnabled ? "false" : "true"}
                  />
                  {theme.buttonEnabled && confirmingOff ? (
                    <BlockStack gap="150">
                      <Text as="p" variant="bodySm">
                        Hide the Configure button on <strong>all</strong> products?
                      </Text>
                      <InlineStack gap="200">
                        <Button submit size="slim" tone="critical" loading={isToggling}>
                          Yes, turn off everywhere
                        </Button>
                        <Button size="slim" onClick={() => setConfirmingOff(false)}>
                          Cancel
                        </Button>
                      </InlineStack>
                    </BlockStack>
                  ) : theme.buttonEnabled ? (
                    // Not a submit — reveals the confirmation step first.
                    <Button size="slim" tone="critical" onClick={() => setConfirmingOff(true)}>
                      Turn off everywhere
                    </Button>
                  ) : (
                    <Button submit size="slim" tone="success" loading={isToggling}>
                      Turn back on
                    </Button>
                  )}
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
      </Layout>
    </Page>
  );
}
