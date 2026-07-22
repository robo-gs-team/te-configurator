import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import {
  AppProvider as PolarisAppProvider,
  BlockStack,
  Box,
  Button,
  Card,
  FormLayout,
  InlineStack,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";
import polarisTranslations from "@shopify/polaris/locales/en.json";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import { login } from "../../shopify.server";

import { loginErrorMessage } from "./error.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const errors = loginErrorMessage(await login(request));

  return { errors, polarisTranslations };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const errors = loginErrorMessage(await login(request));

  return {
    errors,
  };
};

export default function Auth() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [shop, setShop] = useState("");
  const { errors } = actionData || loaderData;

  // The reliable fix for an expired embedded session is a full browser refresh — Shopify then
  // re-embeds the app with a fresh session token and the merchant lands back where they were.
  // A cross-origin top-frame reload isn't permitted from inside the admin iframe, so this button
  // reloads this frame as a best effort and the copy also tells the merchant to refresh the tab.
  const handleRefresh = () => {
    try {
      window.location.reload();
    } catch {
      /* no-op */
    }
  };

  return (
    <PolarisAppProvider i18n={loaderData.polarisTranslations}>
      <Page>
        <BlockStack gap="400">
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h2">
                Your session timed out
              </Text>
              <Text as="p" tone="subdued">
                This usually just means the app was open for a while and needs to reconnect.
                Refresh the page and you&apos;ll be right back where you were — no need to log in
                again.
              </Text>
              <InlineStack gap="200">
                <Button variant="primary" onClick={handleRefresh}>
                  Refresh the page
                </Button>
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                If the button doesn&apos;t do it, refresh your browser tab (⌘R on Mac, Ctrl+R on
                Windows).
              </Text>
            </BlockStack>
          </Card>

          {/* Fallback for the genuine "opened outside Shopify admin" case — enter the store
              domain to start the normal login. Kept secondary so it doesn't read as the primary
              action for the common session-timeout case above. */}
          <Card>
            <Form method="post">
              <FormLayout>
                <Text variant="headingSm" as="h3">
                  Opened this outside Shopify admin?
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Enter your store domain to log in.
                </Text>
                <TextField
                  type="text"
                  name="shop"
                  label="Shop domain"
                  helpText="example.myshopify.com"
                  value={shop}
                  onChange={setShop}
                  autoComplete="on"
                  error={errors.shop}
                />
                <Box>
                  <Button submit>Log in</Button>
                </Box>
              </FormLayout>
            </Form>
          </Card>
        </BlockStack>
      </Page>
    </PolarisAppProvider>
  );
}
