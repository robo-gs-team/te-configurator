import type { LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { useLoaderData } from "@remix-run/react";
import {
  BlockStack,
  Card,
  DataTable,
  Layout,
  Page,
  Text,
} from "@shopify/polaris";
import { ensureShop, getAnalyticsSummary } from "~/lib/configurator.server";
import { parseJson } from "~/lib/configurator.types";
import { authenticate } from "~/shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const analytics = await getAnalyticsSummary(shop.id, 30);
  return json({ analytics });
};

export default function AnalyticsPage() {
  const { analytics } = useLoaderData<typeof loader>();

  const rows = analytics.events.slice(0, 50).map((event) => {
    const meta = parseJson<Record<string, unknown>>(event.metadata, {});
    return [
      new Date(event.createdAt).toLocaleString(),
      event.eventType,
      event.productId ?? "—",
      JSON.stringify(meta).slice(0, 80),
    ];
  });

  return (
    <Page title="Analytics" backAction={{ content: "Dashboard", url: "/app" }}>
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Event summary (30 days)
              </Text>
              {Object.entries(analytics.counts).map(([type, count]) => (
                <Text as="p" key={type}>
                  {type}: {count}
                </Text>
              ))}
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section>
          <Card>
            <DataTable
              columnContentTypes={["text", "text", "text", "text"]}
              headings={["Time", "Event", "Product", "Metadata"]}
              rows={rows}
            />
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
