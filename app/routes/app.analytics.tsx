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

function signedPct(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "—";
  const rounded = Math.round(value);
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
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

function SectionHeading({ children }: { children: string }) {
  return (
    <Text as="h2" variant="headingMd">
      {children}
    </Text>
  );
}

export default function AnalyticsPage() {
  const { analytics } = useLoaderData<typeof loader>();
  const { funnel, revenue, byMode, byDevice, byRacquet, trend, counts } = analytics;

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
    pct(r.purchases, r.opens),
  ]);

  const deviceRows = byDevice.map((d) => [
    d.device,
    String(d.opens),
    String(d.addToCarts),
    String(d.purchases),
    pct(d.addToCarts, d.opens),
  ]);

  const modeRows = Object.entries(byMode).sort((a, b) => b[1] - a[1]);

  // Show the daily trend most-recent-first, capped so the table stays readable.
  const trendRows = [...trend]
    .reverse()
    .slice(0, 30)
    .map((t) => [t.day, String(t.opens), String(t.addToCarts), String(t.purchases)]);

  return (
    <Page
      title="Configurator analytics"
      subtitle="Last 30 days"
      backAction={{ content: "Dashboard", url: "/app" }}
    >
      <Layout>
        {/* Funnel */}
        <Layout.Section>
          <BlockStack gap="300">
            <SectionHeading>Funnel — unique sessions</SectionHeading>
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
                sub={`${pct(funnel.purchaseSessions, funnel.cartSessions)} of carts`}
              />
            </InlineGrid>
            <InlineGrid columns={{ xs: 1, sm: 3 }} gap="300">
              <StatTile
                label="Cart rate"
                value={pct(funnel.cartSessions, funnel.openSessions)}
                sub="opens → add to cart"
              />
              <StatTile
                label="Checkout rate"
                value={pct(funnel.purchaseSessions, funnel.cartSessions)}
                sub="add to cart → purchase"
              />
              <StatTile
                label="Overall conversion"
                value={pct(funnel.purchaseSessions, funnel.openSessions)}
                sub="opens → purchase"
              />
            </InlineGrid>
          </BlockStack>
        </Layout.Section>

        {/* Revenue */}
        <Layout.Section>
          <BlockStack gap="300">
            <SectionHeading>Revenue</SectionHeading>
            <InlineGrid columns={{ xs: 1, sm: 3 }} gap="300">
              <StatTile label="Revenue purchased" value={money(revenue.purchased)} />
              <StatTile
                label="Avg configurator order"
                value={money(revenue.configAOV)}
                sub={`Store AOV ${money(revenue.storeAOV)} · ${signedPct(revenue.aovLiftPct)} vs store`}
              />
              <StatTile
                label="Revenue per open"
                value={money(revenue.revenuePerOpen)}
                sub="purchased ÷ opens"
              />
            </InlineGrid>
            <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
              <StatTile
                label="Incremental revenue added"
                value={money(revenue.incrementalTotal)}
                sub="strings + labor + add-ons beyond the frame"
              />
              <StatTile
                label="Incremental per order"
                value={money(revenue.incrementalPerOrder)}
                sub="avg the configurator adds per order"
              />
            </InlineGrid>
          </BlockStack>
        </Layout.Section>

        {/* Daily trend */}
        {trendRows.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <SectionHeading>Daily trend</SectionHeading>
                <DataTable
                  columnContentTypes={["text", "numeric", "numeric", "numeric"]}
                  headings={["Day", "Opens", "Add to cart", "Purchases"]}
                  rows={trendRows}
                />
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* Mode + device split */}
        <Layout.Section>
          <InlineGrid columns={{ xs: 1, md: 2 }} gap="300">
            <Card>
              <BlockStack gap="300">
                <SectionHeading>Add-to-cart by mode</SectionHeading>
                {modeRows.length > 0 ? (
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
                ) : (
                  <Text as="p" tone="subdued">
                    No data yet.
                  </Text>
                )}
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="300">
                <SectionHeading>By device</SectionHeading>
                {deviceRows.length > 0 ? (
                  <DataTable
                    columnContentTypes={["text", "numeric", "numeric", "numeric", "numeric"]}
                    headings={["Device", "Opens", "Cart", "Buy", "Cart rate"]}
                    rows={deviceRows}
                  />
                ) : (
                  <Text as="p" tone="subdued">
                    No data yet.
                  </Text>
                )}
              </BlockStack>
            </Card>
          </InlineGrid>
        </Layout.Section>

        {/* Top racquets */}
        {racquetRows.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <SectionHeading>Top racquets</SectionHeading>
                <DataTable
                  columnContentTypes={["text", "numeric", "numeric", "numeric", "numeric", "numeric"]}
                  headings={["Product ID", "Opens", "Cart", "Buy", "Cart rate", "Conv."]}
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
              <SectionHeading>Event totals</SectionHeading>
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
              <SectionHeading>Recent events</SectionHeading>
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
