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
import {
  getAllLinkedRacquetProductIds,
  migrateLegacyRacquetTension,
  type TensionMigrationResult,
} from "~/lib/product-metafields.server";
import { getBuildInfo } from "~/lib/build-info.server";
import { getDeploymentStatus } from "~/lib/vercel-status.server";
import { authenticate } from "~/shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const [configurators, analytics, buttonStatus, theme, deployStatus] = await Promise.all([
    listConfigurators(shop.id),
    getAnalyticsSummary(shop.id, 30),
    detectThemeButtonStatus(admin, session.shop),
    getShopThemeSettings(shop.id),
    getDeploymentStatus(),
  ]);

  return json({
    shop: session.shop,
    configurators,
    analytics,
    buttonStatus,
    theme,
    buildInfo: getBuildInfo(),
    deployStatus,
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

  if (intent === "migrate_legacy_tension") {
    const productIds = await getAllLinkedRacquetProductIds(admin, shop.id);
    const migration = await migrateLegacyRacquetTension(admin, productIds);
    // Newly-populated tension fields won't reach shoppers until the snapshot is rebuilt.
    await refreshShopSnapshots(admin, shop.id, session.shop);
    return json({ migration });
  }

  return json({ ok: true });
};

export default function Dashboard() {
  const { shop, configurators, analytics, buttonStatus, theme, buildInfo, deployStatus } =
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
  const isMigrating =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "migrate_legacy_tension";
  const migrationResult = (actionData as { migration?: TensionMigrationResult } | undefined)
    ?.migration;

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
            <BlockStack gap="300">
              <InlineStack gap="150" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  Tension data migration
                </Text>
                <Tooltip content="One-time copy from your prior system's racquet.string_tension_min/max/recommended metafields into this app's own te_stringing.tension_min/max/recommended fields. Only fills in racquets that don't already have a value in the te_stringing fields — never overwrites an existing value. Safe to run more than once.">
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
              <Text as="p" variant="bodySm" tone="subdued">
                Copies per-racquet tension data from your prior system's metafields into the
                fields this app reads, for every racquet linked to a configurator. Skips any
                racquet that already has a value set here — safe to run again later.
              </Text>
              {migrationResult && (
                <Banner tone={migrationResult.updated > 0 ? "success" : "info"}>
                  <p>
                    Checked {migrationResult.total} racquet{migrationResult.total === 1 ? "" : "s"}:{" "}
                    updated {migrationResult.updated}, {migrationResult.skippedAlreadySet} already had
                    a value, {migrationResult.skippedNoLegacyData} had no legacy data to copy.
                  </p>
                </Banner>
              )}
              <Form method="post">
                <input type="hidden" name="intent" value="migrate_legacy_tension" />
                <Button submit size="slim" loading={isMigrating}>
                  Copy existing tension data
                </Button>
              </Form>
            </BlockStack>
          </Card>
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
            <BlockStack gap="150" inlineAlign="center">
              {deployStatus.configured && deployStatus.state !== "unknown" && (
                <Badge
                  tone={
                    deployStatus.state === "up_to_date"
                      ? "success"
                      : deployStatus.state === "failed"
                        ? "critical"
                        : deployStatus.state === "newer_ready"
                          ? "attention"
                          : "info"
                  }
                >
                  {deployStatus.state === "up_to_date"
                    ? "Running the latest build"
                    : deployStatus.state === "newer_building"
                      ? `New build deploying${deployStatus.latestShortSha ? ` (${deployStatus.latestShortSha})` : ""}…`
                      : deployStatus.state === "newer_ready"
                        ? "New build ready — refresh to load it"
                        : "Latest build failed"}
                </Badge>
              )}
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
            </BlockStack>
          </Box>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
