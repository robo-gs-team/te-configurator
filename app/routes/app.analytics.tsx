import type { LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { useLoaderData } from "@remix-run/react";
import {
  BlockStack,
  Card,
  DataTable,
  InlineGrid,
  InlineStack,
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
  const analytics = await getAnalyticsSummary(shop.id, 30, { includeEvents: true });
  return json({ analytics });
};

function pct(numerator: number, denominator: number): string {
  if (denominator <= 0) return "—";
  return `${Math.round((numerator / denominator) * 100)}%`;
}

function money(value: number): string {
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <BlockStack gap="100">
        <Text as="p" variant="bodySm" tone="subdued">
          {label}
        </Text>
        <Text as="p" variant="heading2xl">
          {value}
        </Text>
        {sub && (
          <Text as="p" variant="bodySm" tone="subdued">
            {sub}
          </Text>
        )}
      </BlockStack>
    </Card>
  );
}

export default function AnalyticsPage() {
  const { analytics } = useLoaderData<typeof loader>();
  const { funnel, revenue, byMode, byRacquet, counts } = analytics;

  const eventRows = analytics.events.slice(0, 50).map((event) => {
    const meta = parseJson<Record<string, unknown>>(event.metadata, {});
    return [
      new Date(event.createdAt).toLocaleString(),
      event.eventType,
      event.productId ?? "—",
      JSON.stringify(meta).slice(0, 80),
    ];
  });

  const racquetRows = byRacquet.map((r) => [
    r.productId,
    String(r.opens),
    String(r.addToCarts),
    String(r.purchases),
    pct(r.addToCarts, r.opens),
  ]);

  const modeRows = Object.entries(byMode).sort((a, b) => b[1] - a[1]);

  return (
    <Page
      title="Analytics"
      subtitle="Last 30 days"
      backAction={{ content: "Dashboard", url: "/app" }}
    >
      <Layout>
        {/* Funnel */}
        <Layout.Section>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Configurator funnel (unique sessions)
            </Text>
            <InlineGrid columns={{ xs: 1, sm: 3 }} gap="300">
              <StatTile label="Opened configurator" value={String(funnel.openSessions)} />
              <StatTile
                label="Added to cart"
                value={String(funnel.cartSessions)}
                sub={`${pct(funnel.cartSessions, funnel.openSessions)} of opens`}
              />
              <StatTile
                label="Purchased"
                value={String(funnel.purchaseSessions)}
                sub={`${pct(funnel.purchaseSessions, funnel.cartSessions)} of carts · ${pct(
                  funnel.purchaseSessions,
                  funnel.openSessions,
                )} of opens`}
              />
            </InlineGrid>
          </BlockStack>
        </Layout.Section>

        {/* Revenue */}
        <Layout.Section>
          <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
            <StatTile label="Revenue added to cart" value={money(revenue.added)} />
            <StatTile
              label="Revenue purchased"
              value={money(revenue.purchased)}
              sub="Attributed from placed orders"
            />
          </InlineGrid>
        </Layout.Section>

        {/* Mode split */}
        {modeRows.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Add-to-cart by mode
                </Text>
                <InlineStack gap="600">
                  {modeRows.map(([mode, count]) => (
                    <BlockStack gap="050" key={mode}>
                      <Text as="p" variant="headingLg">
                        {String(count)}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {mode}
                      </Text>
                    </BlockStack>
                  ))}
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* Top racquets */}
        {racquetRows.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Top racquets
                </Text>
                <DataTable
                  columnContentTypes={["text", "numeric", "numeric", "numeric", "numeric"]}
                  headings={["Product ID", "Opens", "Add to cart", "Purchases", "Cart rate"]}
                  rows={racquetRows}
                />
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* Raw event totals */}
        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                Event totals
              </Text>
              {Object.entries(counts).map(([type, count]) => (
                <Text as="p" key={type}>
                  {type}: {count}
                </Text>
              ))}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Recent events */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Recent events
              </Text>
              <DataTable
                columnContentTypes={["text", "text", "text", "text"]}
                headings={["Time", "Event", "Product", "Metadata"]}
                rows={eventRows}
              />
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
