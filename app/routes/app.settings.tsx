import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { Form, useLoaderData, useNavigation } from "@remix-run/react";
import {
  BlockStack,
  Badge,
  Button,
  Card,
  Checkbox,
  FormLayout,
  InlineStack,
  Layout,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";
import { useState } from "react";
import prisma from "~/db.server";
import { ensureShop, getShopThemeSettings } from "~/lib/configurator.server";
import { refreshShopSnapshots } from "~/lib/snapshot.server";
import { getVersionInfo } from "~/lib/version.server";
import { authenticate } from "~/shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const theme = await getShopThemeSettings(shop.id);
  const versions = getVersionInfo();
  return json({ theme, versions });
};

/** Mobile string count: a small positive integer. Clamp to 1–20 (20 = the desktop count, the
 *  sensible ceiling) and fall back to the 6 default on junk input. */
function clampMobileCount(raw: FormDataEntryValue | null): number {
  const n = parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n)) return 6;
  return Math.min(20, Math.max(1, n));
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const form = await request.formData();

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
      </Layout>
    </Page>
  );
}
