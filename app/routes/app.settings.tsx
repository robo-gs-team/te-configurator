import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import {
  BlockStack,
  Badge,
  Banner,
  Button,
  Card,
  Checkbox,
  FormLayout,
  InlineStack,
  Layout,
  Page,
  Text,
  TextField,
  Tooltip,
} from "@shopify/polaris";
import { useState } from "react";
import prisma from "~/db.server";
import { ensureShop, getShopThemeSettings } from "~/lib/configurator.server";
import {
  INTERACTIVE_SALES_MAX_PAGES,
  refreshShopSnapshots,
} from "~/lib/snapshot.server";
import {
  getAllLinkedRacquetProductIds,
  migrateLegacyRacquetTension,
  type TensionMigrationResult,
} from "~/lib/product-metafields.server";
import { getVersionInfo } from "~/lib/version.server";
import { startTimings, timingHeaders } from "~/lib/server-timing.server";
import { authenticate } from "~/shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const timings = startTimings();
  const { session } = await authenticate.admin(request);
  timings.mark("auth");
  const shop = await ensureShop(session.shop);
  timings.mark("shop");
  const theme = await getShopThemeSettings(shop.id);
  timings.mark("db");
  const versions = getVersionInfo();
  return json({ theme, versions }, { headers: timingHeaders(timings) });
};

/** Mobile string count: a small positive integer. Clamp to 1–20 (20 = the desktop count, the
 *  sensible ceiling) and fall back to the 6 default on junk input. */
function clampMobileCount(raw: FormDataEntryValue | null): number {
  const n = parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n)) return 6;
  return Math.min(20, Math.max(1, n));
}

// The "Rebuild storefront data now" action re-scans Shopify orders for the best-seller tally,
// which is a bounded but real sequence of Admin API round trips — well past the default budget.
export const config = { maxDuration: 60 };

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const form = await request.formData();

  if (String(form.get("intent")) === "refresh_snapshots") {
    // Stamp BEFORE the rebuild so we can tell which configurators actually got a fresh snapshot:
    // refreshShopSnapshots is best-effort and swallows per-configurator errors, so without this
    // comparison a total failure would report identically to a total success.
    const startedAt = new Date();
    // refreshSales: this button is the merchant's explicit "make the storefront current" action,
    // so it re-scans orders for the best-seller tally rather than carrying the old one forward.
    // Without it, a shop that had never completed a nightly cron run could press this forever and
    // still see strings in their raw default order, because carry-forward has nothing to carry.
    const build = await refreshShopSnapshots(admin, shop.id, session.shop, {
      refreshSales: true,
      salesMaxPages: INTERACTIVE_SALES_MAX_PAGES,
    });

    // Deliberately does NOT select enrichedSnapshot — that column holds ~300KB per row, and the
    // timestamp alone answers the question.
    const rows = await prisma.configurator.findMany({
      where: { shopId: shop.id, isActive: true },
      select: { name: true, snapshotUpdatedAt: true },
    });
    const isFresh = (at: Date | null) => at !== null && at >= startedAt;
    return json({
      snapshots: {
        total: rows.length,
        refreshed: rows.filter((r) => isFresh(r.snapshotUpdatedAt)).length,
        failed: rows.filter((r) => !isFresh(r.snapshotUpdatedAt)).map((r) => r.name),
        // Reported so "did the best-seller analysis actually work?" is answerable from this screen
        // instead of from server logs nobody can see. 0-of-N is the diagnostic that matters: it
        // means the order scan ran and matched nothing, which points at the read_orders grant
        // rather than at the rebuild.
        // Presence of this key (not its value) is what the UI gates on, so the line renders even
        // when the numbers are zero — a 0-of-0 result is a finding, not a reason to stay silent.
        salesRefreshed: build?.salesRefreshed ?? false,
        stringCatalogSize: build?.stringCatalogSize ?? 0,
        stringsWithSales: build?.stringsWithSales ?? 0,
      },
    });
  }

  if (String(form.get("intent")) === "migrate_legacy_tension") {
    const productIds = await getAllLinkedRacquetProductIds(admin, shop.id);
    const migration = await migrateLegacyRacquetTension(admin, productIds);
    // Newly-populated tension fields won't reach shoppers until the snapshot is rebuilt.
    await refreshShopSnapshots(admin, shop.id, session.shop);
    return json({ migration });
  }

  await prisma.themeSetting.upsert({
    where: { shopId: shop.id },
    create: {
      shopId: shop.id,
      buttonEnabled: form.get("buttonEnabled") === "on",
      buttonLabel: String(form.get("buttonLabel") || "Customize Product"),
      buttonBgColor: String(form.get("buttonBgColor") || "#111827"),
      buttonTextColor: String(form.get("buttonTextColor") || "#ffffff"),
      buttonRadius: String(form.get("buttonRadius") || "12px"),
      buttonPosition: String(form.get("buttonPosition") || "after_add_to_cart"),
      modalTheme: String(form.get("modalTheme") || "dark"),
      modalAccent: String(form.get("modalAccent") || "#6366f1"),
      overlayBlur: parseInt(String(form.get("overlayBlur") || "12"), 10) || 12,
      fontFamily: String(form.get("fontFamily") || "system-ui"),
      mobileStringCount: clampMobileCount(form.get("mobileStringCount")),
    },
    update: {
      buttonEnabled: form.get("buttonEnabled") === "on",
      buttonLabel: String(form.get("buttonLabel") || "Customize Product"),
      buttonBgColor: String(form.get("buttonBgColor") || "#111827"),
      buttonTextColor: String(form.get("buttonTextColor") || "#ffffff"),
      buttonRadius: String(form.get("buttonRadius") || "12px"),
      buttonPosition: String(form.get("buttonPosition") || "after_add_to_cart"),
      modalTheme: String(form.get("modalTheme") || "dark"),
      modalAccent: String(form.get("modalAccent") || "#6366f1"),
      overlayBlur: parseInt(String(form.get("overlayBlur") || "12"), 10) || 12,
      fontFamily: String(form.get("fontFamily") || "system-ui"),
      mobileStringCount: clampMobileCount(form.get("mobileStringCount")),
    },
  });

  // Theme values are baked into each configurator's snapshot, so rebuild them all
  // (best-effort) — otherwise styling changes wouldn't reach the storefront until the cron.
  await refreshShopSnapshots(admin, shop.id, session.shop);

  return json({ success: true });
};

/** "Jul 23, 2026, 3:16 PM" — no dependency, just Intl. Falls back to the raw ISO string on a
 *  malformed date rather than throwing. */
function formatVersionDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

export default function ThemeSettings() {
  const { theme, versions } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const actionData = useActionData<typeof action>();
  const isMigrating =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "migrate_legacy_tension";
  const migrationResult = (actionData as { migration?: TensionMigrationResult } | undefined)
    ?.migration;
  const isRefreshingSnapshots =
    navigation.state !== "idle" && navigation.formData?.get("intent") === "refresh_snapshots";
  const snapshotResult = (
    actionData as
      | {
          snapshots?: {
            total: number;
            refreshed: number;
            failed: string[];
            salesRefreshed?: boolean;
            stringCatalogSize?: number;
            stringsWithSales?: number;
          };
        }
      | undefined
  )?.snapshots;

  const [buttonEnabled, setButtonEnabled] = useState(theme.buttonEnabled);
  const [buttonLabel, setButtonLabel] = useState(theme.buttonLabel);
  const [buttonBgColor, setButtonBgColor] = useState(theme.buttonBgColor);
  const [buttonTextColor, setButtonTextColor] = useState(theme.buttonTextColor);
  const [buttonRadius, setButtonRadius] = useState(theme.buttonRadius.replace("px", ""));
  const [modalTheme, setModalTheme] = useState(theme.modalTheme);
  const [modalAccent, setModalAccent] = useState(theme.modalAccent);
  const [overlayBlur, setOverlayBlur] = useState(String(theme.overlayBlur));
  const [fontFamily, setFontFamily] = useState(theme.fontFamily);
  const [mobileStringCount, setMobileStringCount] = useState(
    String((theme as { mobileStringCount?: number }).mobileStringCount ?? 6),
  );

  return (
    <Page title="Theme settings" backAction={{ content: "Dashboard", url: "/app" }}>
      <Layout>
        <Layout.Section>
          <Card>
            <Form method="post">
              <BlockStack gap="400">
                <FormLayout>
                  <Checkbox
                    label="Enable customize button globally"
                    name="buttonEnabled"
                    checked={buttonEnabled}
                    onChange={setButtonEnabled}
                  />
                  <TextField
                    label="Button label"
                    name="buttonLabel"
                    value={buttonLabel}
                    onChange={setButtonLabel}
                    autoComplete="off"
                  />
                  <FormLayout.Group>
                    <TextField
                      label="Button background"
                      name="buttonBgColor"
                      value={buttonBgColor}
                      onChange={setButtonBgColor}
                      autoComplete="off"
                    />
                    <TextField
                      label="Button text color"
                      name="buttonTextColor"
                      value={buttonTextColor}
                      onChange={setButtonTextColor}
                      autoComplete="off"
                    />
                  </FormLayout.Group>
                  <TextField
                    label="Button border radius (px)"
                    name="buttonRadius"
                    value={buttonRadius}
                    onChange={setButtonRadius}
                    autoComplete="off"
                  />
                  <TextField
                    label="Modal theme"
                    name="modalTheme"
                    value={modalTheme}
                    onChange={setModalTheme}
                    helpText="dark or light"
                    autoComplete="off"
                  />
                  <TextField
                    label="Modal accent color"
                    name="modalAccent"
                    value={modalAccent}
                    onChange={setModalAccent}
                    autoComplete="off"
                  />
                  <TextField
                    label="Overlay blur (px)"
                    name="overlayBlur"
                    value={overlayBlur}
                    onChange={setOverlayBlur}
                    type="number"
                    autoComplete="off"
                  />
                  <TextField
                    label="Font family"
                    name="fontFamily"
                    value={fontFamily}
                    onChange={setFontFamily}
                    autoComplete="off"
                  />
                  <TextField
                    label="Strings shown on mobile"
                    name="mobileStringCount"
                    value={mobileStringCount}
                    onChange={setMobileStringCount}
                    type="number"
                    min={1}
                    max={20}
                    helpText="How many strings the picker shows before “Show more” on phones (1–20). Desktop always shows 20."
                    autoComplete="off"
                  />
                </FormLayout>
                <Button submit variant="primary" loading={navigation.state !== "idle"}>
                  Save settings
                </Button>
              </BlockStack>
            </Form>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Configurator version
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Your live theme runs the <strong>Stable</strong> channel; a draft/test theme set
                to <strong>Beta</strong> in Theme Editor → App embeds runs the latest build. Ask
                for a promotion once a tested Beta build should become the new Stable.
              </Text>
              <BlockStack gap="150">
                <InlineStack gap="200" blockAlign="center">
                  <Badge tone="success">Stable</Badge>
                  <Text as="span" variant="bodySm" fontWeight="semibold">
                    {versions.stable.version}
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    — {versions.stable.label}
                  </Text>
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  Promoted {formatVersionDate(versions.stable.promotedAt)} · commit{" "}
                  {versions.stable.commit.slice(0, 8)}
                  {versions.stable.rollbackOf ? ` · rollback of ${versions.stable.rollbackOf}` : ""}
                </Text>
              </BlockStack>
              <BlockStack gap="150">
                <InlineStack gap="200" blockAlign="center">
                  <Badge tone="attention">Beta</Badge>
                  <Text as="span" variant="bodySm" fontWeight="semibold">
                    {versions.beta.commit ? versions.beta.commit.slice(0, 8) : "unknown"}
                  </Text>
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  {versions.beta.message
                    ? `"${versions.beta.message}"`
                    : "Always mirrors the latest code on main."}
                  {versions.beta.ref ? ` (${versions.beta.ref})` : ""}
                </Text>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Storefront data cache
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Each configurator keeps a prebuilt snapshot of its strings, prices and images so
                product pages load fast. It rebuilds automatically whenever you save, and again
                nightly. Rebuild it here if prices or stock look out of date on the storefront, or
                after changing products outside this app.
              </Text>
              {snapshotResult && (
                <Banner tone={snapshotResult.failed.length === 0 ? "success" : "warning"}>
                  <p>
                    Rebuilt {snapshotResult.refreshed} of {snapshotResult.total} active
                    configurator{snapshotResult.total === 1 ? "" : "s"}.
                    {snapshotResult.failed.length > 0 &&
                      ` Failed: ${snapshotResult.failed.join(", ")}. Check that these are linked to products and try again.`}
                    {typeof snapshotResult.salesRefreshed === "boolean" && (
                      <>
                        {" "}
                        Best-seller data: {snapshotResult.stringsWithSales} of{" "}
                        {snapshotResult.stringCatalogSize} strings have sales in the last 60 days.
                        {snapshotResult.stringCatalogSize === 0 &&
                          " No string products were found on this configurator at all — its string" +
                            " option group looks empty, so there was nothing to rank."}
                        {(snapshotResult.stringCatalogSize ?? 0) > 0 &&
                          snapshotResult.stringsWithSales === 0 &&
                          " None matched — the app may not have permission to read orders yet." +
                            " Open Apps → TE Configurator and accept the permissions prompt," +
                            " then rebuild again."}
                      </>
                    )}
                  </p>
                </Banner>
              )}
              <Form method="post">
                <input type="hidden" name="intent" value="refresh_snapshots" />
                <Button submit size="slim" loading={isRefreshingSnapshots}>
                  Rebuild storefront data now
                </Button>
              </Form>
            </BlockStack>
          </Card>
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
                One-time setup tool — copies per-racquet tension data from your prior system's
                metafields into the fields this app reads, for every racquet linked to a
                configurator. Skips any racquet that already has a value set here — safe to run
                again later if you link new racquets.
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
      </Layout>
    </Page>
  );
}
