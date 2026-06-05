import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useLoaderData, useNavigation } from "@remix-run/react";
import {
  BlockStack,
  Button,
  Card,
  Checkbox,
  FormLayout,
  Layout,
  Page,
  TextField,
} from "@shopify/polaris";
import { useState } from "react";
import prisma from "~/db.server";
import { ensureShop, getShopThemeSettings } from "~/lib/configurator.server";
import { authenticate } from "~/shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const theme = await getShopThemeSettings(shop.id);
  return json({ theme });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
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
    },
  });

  return json({ success: true });
};

export default function ThemeSettings() {
  const { theme } = useLoaderData<typeof loader>();
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
                </FormLayout>
                <Button submit variant="primary" loading={navigation.state !== "idle"}>
                  Save settings
                </Button>
              </BlockStack>
            </Form>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
