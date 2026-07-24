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
  Collapsible,
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
import { detectAppEmbedStatus, type AppEmbedStatus } from "~/lib/theme-detection.server";
import { themeEditorEmbedUrl } from "~/lib/theme-embed";
import { refreshShopSnapshots } from "~/lib/snapshot.server";
import { getVersionInfo } from "~/lib/version.server";
import { authenticate } from "~/shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const [configurators, analytics, embed, theme] = await Promise.all([
    listConfigurators(shop.id),
    getAnalyticsSummary(shop.id, 30),
    detectAppEmbedStatus(admin, session.shop),
    getShopThemeSettings(shop.id),
  ]);

  return json({
    shop: session.shop,
    configurators,
    analytics,
    embed,
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
    // Shop-wide kill switch: rebuild every snapshot (best-effort) so the change reaches every
    // product page immediately instead of waiting on the daily cron.
    await refreshShopSnapshots(admin, shop.id, session.shop);
    return json({ success: true });
  }

  return json({ ok: true });
};

/** "Jul 23, 2026, 3:16 PM" — matches the Settings version card. Falls back to the raw string. */
function formatVersionDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(d);
}

/** Human label for a Shopify theme role. */
function roleLabel(role: string): string {
  switch (role) {
    case "MAIN":
      return "live";
    case "DEVELOPMENT":
      return "dev";
    case "UNPUBLISHED":
      return "draft";
    case "DEMO":
      return "demo";
    default:
      return role.toLowerCase();
  }
}

/** One metric tile. */
function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <BlockStack gap="100">
        <Text as="p" variant="bodySm" tone="subdued">
          {label}
        </Text>
        <Text as="p" variant="headingXl">
          {value}
        </Text>
      </BlockStack>
    </Card>
  );
}

/** "Where is the app embed on" line for the Storefront button card. */
function EmbedThemes({ embed, shop }: { embed: AppEmbedStatus; shop: string }) {
  if (!embed.ok) {
    const hint =
      embed.reason === "missing_theme_scope"
        ? "Can't read your themes (missing theme permission) — reopen the app to grant it. This is informational and doesn't affect the storefront."
        : embed.reason === "no_themes"
          ? "No themes found for this store."
          : "Couldn't reach Shopify to check your themes — try again shortly.";
    return (
      <Text as="p" variant="bodySm" tone="subdued">
        {hint}
      </Text>
    );
  }

  const liveOn = embed.live?.on ?? false;
  return (
    <BlockStack gap="150">
      <InlineStack gap="200" blockAlign="center" wrap>
        <Text as="span" variant="bodySm" tone="subdued">
          App embed
        </Text>
        {embed.live ? (
          <Badge tone={liveOn ? "success" : "warning"}>
            {liveOn ? `On · ${embed.live.name} (live)` : `Off on live theme (${embed.live.name})`}
          </Badge>
        ) : (
          <Badge tone="warning">No published theme found</Badge>
        )}
        {embed.live && !liveOn && (
          <Button variant="plain" size="slim" url={themeEditorEmbedUrl(shop, embed.live.id)} target="_blank">
            Enable in Theme Editor →
          </Button>
        )}
      </InlineStack>
      {embed.otherOn.length > 0 && (
        <Text as="p" variant="bodySm" tone="subdued">
          Also on: {embed.otherOn.map((t) => `${t.name} (${roleLabel(t.role)})`).join(", ")}
        </Text>
      )}
    </BlockStack>
  );
}

export default function Dashboard() {
  const { shop, configurators, analytics, embed, theme, versions } =
    useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const actionData = useActionData<typeof action>();
  const [confirmingOff, setConfirmingOff] = useState(false);
  const [showVersion, setShowVersion] = useState(false);

  const isToggling =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "toggle_button_enabled";
  const toggleJustSucceeded =
    navigation.state === "idle" &&
    Boolean((actionData as { success?: boolean } | undefined)?.success);

  const modalOpens = analytics.counts.modal_open ?? 0;
  const addToCart = analytics.counts.add_to_cart ?? 0;
  const conversion = modalOpens > 0 ? `${Math.round((addToCart / modalOpens) * 100)}%` : "—";

  const cfgs = configurators as Array<{
    id: string;
    name: string;
    _count: { steps: number; addons: number };
    isActive: boolean;
  }>;
  const activeCount = cfgs.filter((c) => c.isActive).length;
  const embedAnywhere = embed.ok && ((embed.live?.on ?? false) || embed.otherOn.length > 0);
  const isSetUp = activeCount > 0 && embedAnywhere;

  const betaSha = versions.beta.commit ? versions.beta.commit.slice(0, 8) : "unknown";
  const betaFirstLine = versions.beta.message?.split("\n")[0] ?? "Latest code on main.";

  return (
    <Page
      title="TE Racquet Configurator"
      primaryAction={{ content: "Create configurator", url: "/app/configurators/new" }}
    >
      <Layout>
        {/* Version — slim by default, details behind a disclosure. */}
        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <InlineStack align="space-between" blockAlign="center" wrap>
                <InlineStack gap="200" blockAlign="center" wrap>
                  <Badge tone="success">{`Live · Stable ${versions.stable.version}`}</Badge>
                  <Text as="span" variant="bodySm" tone="subdued">
                    Beta {betaSha}
                  </Text>
                </InlineStack>
                <Button
                  variant="plain"
                  disclosure={showVersion ? "up" : "down"}
                  onClick={() => setShowVersion((v) => !v)}
                >
                  {showVersion ? "Hide" : "Details"}
                </Button>
              </InlineStack>
              <Collapsible id="version-details" open={showVersion}>
                <BlockStack gap="150">
                  <Text as="p" variant="bodySm" tone="subdued">
                    <strong>Stable {versions.stable.version}</strong> — {versions.stable.label} · promoted{" "}
                    {formatVersionDate(versions.stable.promotedAt)}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    <strong>Beta {betaSha}</strong> — {betaFirstLine}
                  </Text>
                  <Box>
                    <Button variant="plain" size="slim" url="/app/settings">
                      Full version history →
                    </Button>
                  </Box>
                </BlockStack>
              </Collapsible>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Metrics. */}
        <Layout.Section>
          <InlineGrid columns={{ xs: 1, sm: 3 }} gap="400">
            <Stat label="Modal opens (30d)" value={modalOpens} />
            <Stat label="Add to cart (30d)" value={addToCart} />
            <Stat label="Conversion (30d)" value={conversion} />
          </InlineGrid>
        </Layout.Section>

        {/* Storefront button: master switch + where the embed is on, in one place. */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  Storefront button
                </Text>
                <Badge tone={theme.buttonEnabled ? "success" : "critical"}>
                  {theme.buttonEnabled ? "On" : "Off — shop-wide"}
                </Badge>
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                {theme.buttonEnabled
                  ? "Shoppers see the Configure button on product pages where the app embed is enabled."
                  : "The Configure button is hidden on all products, even where the app embed is on."}
              </Text>

              <EmbedThemes embed={embed} shop={shop} />

              {toggleJustSucceeded && (
                <Banner tone={theme.buttonEnabled ? "success" : "warning"}>
                  <p>
                    {theme.buttonEnabled
                      ? "Configure button turned back on — up to a minute to appear on the storefront."
                      : "Configure button turned off across all products — up to a minute to disappear."}
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
        </Layout.Section>

        {/* Configurators. */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  Configurators
                </Text>
                <Button url="/app/configurators">View all</Button>
              </InlineStack>

              {activeCount > 1 && (
                <Banner tone="warning">
                  <p>
                    {activeCount} configurators are active. The storefront uses one per product —
                    keep a single active configurator (with multiple steps if needed) and set the
                    rest to Draft to avoid confusion.
                  </p>
                </Banner>
              )}

              {cfgs.length === 0 ? (
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
                cfgs.slice(0, 5).map((c) => (
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

        {/* Setup checklist — only until the app is actually set up, then it disappears. */}
        {!isSetUp && (
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Finish setup
                </Text>
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm">
                    1. Create a configurator and select your racquet products
                  </Text>
                  <Text as="p" variant="bodySm">
                    2. Theme Editor → App embeds → enable Proto Configurator
                  </Text>
                  <Text as="p" variant="bodySm">
                    3. Product page → add the Configurator Button block
                  </Text>
                </BlockStack>
                <Box>
                  <Button url="/app/settings">Theme settings</Button>
                </Box>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}
