import { normalizeProductId } from "~/lib/product-id";

type ShopifyAdmin = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

// The `read_orders` scope returns orders from roughly the last 60 days without the
// app-review-gated `read_all_orders` scope, so we window best-seller data to 60 days. Bump this
// (and request read_all_orders) only if a longer window is ever needed — 60 days is a strong
// best-seller signal on its own.
const SALES_WINDOW_DAYS = 60;
// Page sizes chosen to keep the GraphQL query cost comfortably under Shopify's per-query limit:
// 50 orders × (10 line items + overhead) ≈ 600 cost points (< 1000). A stringing order rarely has
// more than a handful of line items, so first:10 line items captures them all in practice.
const ORDERS_PAGE_SIZE = 50;
const LINE_ITEMS_PAGE_SIZE = 10;
// Safety cap so a very large store can't run the nightly tally unbounded. We sort newest-first, so
// if a store exceeds this the tally is still based on the freshest orders in the window.
const MAX_ORDER_PAGES = 300;

const ORDER_SALES_QUERY = `#graphql
  query ProtoStringSales($cursor: String, $query: String!) {
    orders(first: ${ORDERS_PAGE_SIZE}, after: $cursor, query: $query, sortKey: CREATED_AT, reverse: true) {
      nodes {
        lineItems(first: ${LINE_ITEMS_PAGE_SIZE}) {
          nodes {
            quantity
            product {
              legacyResourceId
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

type OrderSalesResponse = {
  data?: {
    orders?: {
      nodes?: Array<{
        lineItems?: {
          nodes?: Array<{
            quantity?: number;
            product?: { legacyResourceId?: string } | null;
          }>;
        };
      }>;
      pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
    };
  };
  errors?: unknown;
};

/**
 * Tally units sold per string product over the last {@link SALES_WINDOW_DAYS}, for best-seller
 * sorting of the string picker.
 *
 * Restricted to `stringProductIds` so the returned map stays small (only the strings this
 * configurator actually shows). Best-effort by design: on ANY error — including the expected
 * ACCESS_DENIED before the merchant re-consents to the `read_orders` scope — it logs and returns
 * whatever it has accumulated (possibly empty). The snapshot build therefore never fails and the
 * storefront simply falls back to the merchant's default string order until real sales data lands.
 *
 * @param now injected for a deterministic window boundary; callers pass `new Date()`.
 * @returns map of normalized product id -> units sold in the window (only for wanted products).
 */
export async function resolveStringUnitsSold(
  admin: ShopifyAdmin,
  stringProductIds: string[],
  now: Date,
): Promise<Record<string, number>> {
  if (stringProductIds.length === 0) return {};

  const wanted = new Set(stringProductIds.map((id) => normalizeProductId(String(id))));
  const since = new Date(now.getTime() - SALES_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const sinceStr = since.toISOString().slice(0, 10); // YYYY-MM-DD — Shopify order search syntax
  const query = `created_at:>=${sinceStr}`;

  const tally: Record<string, number> = {};
  let cursor: string | null = null;
  let hasNextPage = true;
  let pages = 0;

  try {
    while (hasNextPage && pages < MAX_ORDER_PAGES) {
      pages++;
      const response = await admin.graphql(ORDER_SALES_QUERY, {
        variables: { cursor, query },
      });
      const body = (await response.json()) as OrderSalesResponse;

      if (body.errors) {
        // e.g. ACCESS_DENIED when read_orders hasn't been granted yet — stop and return what we
        // have (typically empty). Not an exceptional condition; the storefront degrades gracefully.
        console.error(
          "resolveStringUnitsSold: GraphQL errors (returning partial tally):",
          body.errors,
        );
        break;
      }

      const orders = body.data?.orders;
      for (const order of orders?.nodes ?? []) {
        for (const li of order?.lineItems?.nodes ?? []) {
          const legacy = li?.product?.legacyResourceId;
          if (!legacy) continue;
          const pid = normalizeProductId(String(legacy));
          if (!wanted.has(pid)) continue;
          tally[pid] = (tally[pid] ?? 0) + (li.quantity ?? 0);
        }
      }

      hasNextPage = orders?.pageInfo?.hasNextPage ?? false;
      cursor = orders?.pageInfo?.endCursor ?? null;
    }

    if (hasNextPage && pages >= MAX_ORDER_PAGES) {
      console.warn(
        `resolveStringUnitsSold: reached MAX_ORDER_PAGES (${MAX_ORDER_PAGES}); best-seller tally ` +
          `is based on the most recent ${MAX_ORDER_PAGES * ORDERS_PAGE_SIZE} orders in the window.`,
      );
    }
  } catch (err) {
    console.error("resolveStringUnitsSold failed (returning partial/empty tally):", err);
  }

  return tally;
}
