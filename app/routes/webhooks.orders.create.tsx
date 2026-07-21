import type { ActionFunctionArgs } from "@vercel/remix";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { ensureShop, trackAnalyticsEvent } from "../lib/configurator.server";

// Shopify order/create webhook payload (REST-style snake_case). We only read the few fields we
// need to attribute a purchase to a configurator.
type WebhookLineItemProperty = { name?: string; value?: string };
type WebhookLineItem = {
  product_id?: number | string | null;
  price?: string | number;
  quantity?: number;
  properties?: WebhookLineItemProperty[] | null;
};
type OrderWebhookPayload = {
  id?: number | string;
  currency?: string;
  line_items?: WebhookLineItem[];
};

function propMap(props?: WebhookLineItemProperty[] | null): Record<string, string> {
  const map: Record<string, string> = {};
  for (const p of props ?? []) {
    if (p?.name != null) map[p.name] = String(p.value ?? "");
  }
  return map;
}

/**
 * orders/create → record a `purchase` analytics event for orders placed through the configurator.
 *
 * Configurator orders are identified by the line-item properties the storefront stamps on them
 * (`_configurator_id` on the racquet line, `_parent_configurator` on string/labor/addon lines).
 * We attribute the purchase to the same browsing session via the hidden `_proto_session` property,
 * so the dashboard can compute a real open → add-to-cart → purchase funnel. Attributed revenue is
 * the sum of the configurator lines (racquet + strings + labor + addons).
 *
 * Only requires the read_orders scope (already granted); we never write back to the order here.
 * Best-effort and idempotent — orders/create can be delivered more than once, so we skip an order
 * already recorded.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  const order = payload as OrderWebhookPayload;
  const lineItems = order.line_items ?? [];

  const configuratorLines = lineItems.filter((li) => {
    const m = propMap(li.properties);
    return "_configurator_id" in m || "_parent_configurator" in m;
  });
  if (configuratorLines.length === 0) {
    // Not a configurator order — nothing to record.
    return new Response();
  }

  // The racquet line carries _configurator_id (plus the full spec); fall back to the first
  // configurator line if a future flow only sets _parent_configurator.
  const racquetLine =
    configuratorLines.find((li) => "_configurator_id" in propMap(li.properties)) ??
    configuratorLines[0];
  const racquetProps = propMap(racquetLine.properties);
  const configuratorId =
    racquetProps["_configurator_id"] || racquetProps["_parent_configurator"] || undefined;
  const productId = racquetLine.product_id ? String(racquetLine.product_id) : undefined;
  const sessionId = racquetProps["_proto_session"] || undefined;
  const mode = racquetProps["Stringing mode"]?.toLowerCase() || undefined;

  const value = configuratorLines.reduce((sum, li) => {
    const price = Number(li.price ?? 0);
    const qty = Number(li.quantity ?? 1);
    return sum + (Number.isFinite(price) ? price * qty : 0);
  }, 0);

  const orderId = order.id != null ? String(order.id) : undefined;

  const shopRecord = await ensureShop(shop);

  // Idempotency: skip if this order was already recorded (webhook re-delivery).
  if (orderId) {
    const existing = await prisma.analytics.findFirst({
      where: {
        shopId: shopRecord.id,
        eventType: "purchase",
        metadata: { contains: `"orderId":"${orderId}"` },
      },
      select: { id: true },
    });
    if (existing) return new Response();
  }

  await trackAnalyticsEvent({
    shopId: shopRecord.id,
    configuratorId,
    eventType: "purchase",
    productId,
    sessionId,
    metadata: { orderId, value, mode, currency: order.currency },
  });

  return new Response();
};
