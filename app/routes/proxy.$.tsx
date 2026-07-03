import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import {
  ensureShop,
  getConfiguratorForProduct,
  lookupConfiguratorForProduct,
  getSavedConfiguration,
  getShopThemeSettings,
  saveConfiguration,
  trackAnalyticsEvent,
} from "~/lib/configurator.server";
import { serializeConfiguratorPayload } from "~/lib/configurator.types";
import { sanitizeInput } from "~/lib/conditional-logic";
import { enrichConfiguratorWithShopifyData } from "~/lib/enrich-configurator.server";
import { normalizeProductId } from "~/lib/product-id";
import {
  getCachedProxyResponse,
  setCachedProxyResponse,
} from "~/lib/proxy-cache.server";
import { authenticate, unauthenticated } from "~/shopify.server";

const PROXY_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, max-age=300, stale-while-revalidate=60",
} as const;

async function resolveShopDomain(request: Request): Promise<string | null> {
  const url = new URL(request.url);
  const fromQuery = url.searchParams.get("shop");
  if (fromQuery) return fromQuery;

  try {
    const context = await authenticate.public.appProxy(request);
    if (context.session?.shop) return context.session.shop;
  } catch {
    // Unsigned local/dev requests may omit a valid signature.
  }

  return null;
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const shopDomain = await resolveShopDomain(request);
  if (!shopDomain) {
    return json({ error: "Missing shop parameter" }, { status: 400 });
  }

  const path = params["*"] ?? "";

  if (path.startsWith("product/")) {
    const productId = normalizeProductId(path.replace("product/", ""));

    // Serve from server-side cache when available — skips all DB + Shopify calls
    const cached = getCachedProxyResponse(shopDomain, productId);
    if (cached) {
      return json(cached, { headers: { ...PROXY_HEADERS, "X-Cache": "HIT" } });
    }

    let admin: Awaited<ReturnType<typeof unauthenticated.admin>>["admin"] | undefined;
    try {
      const context = await unauthenticated.admin(shopDomain);
      admin = context.admin;
    } catch {
      // Collection lookup and product images require an installed app session.
    }

    const lookup = await lookupConfiguratorForProduct(shopDomain, productId, admin);

    if (lookup.status === "inactive") {
      return json({
        configurator: null,
        error:
          'Configurator "' +
          lookup.configurator.name +
          '" is linked to this product but is not Active. Open the app admin, check Active, and click Save changes.',
        productId,
        code: "inactive",
      });
    }

    if (lookup.status === "not_linked") {
      return json({
        configurator: null,
        error:
          "No configurator linked to this product. Select a racquet collection in the app admin and click Save changes.",
        productId,
        code: "not_linked",
      });
    }

    // B1: serve from DB snapshot — zero Admin API enrichment calls on the hot path
    const snap = (lookup.configurator as typeof lookup.configurator & {
      enrichedSnapshot?: string | null;
    }).enrichedSnapshot;

    if (snap) {
      try {
        const responseData = JSON.parse(snap) as Record<string, unknown>;
        setCachedProxyResponse(shopDomain, productId, responseData);
        return json(responseData, { headers: { ...PROXY_HEADERS, "X-Cache": "SNAPSHOT" } });
      } catch (err) {
        // Corrupt/truncated snapshot — don't 500 the page; fall through to live enrichment.
        console.error(`Corrupt enrichedSnapshot for product ${productId}:`, err);
      }
    }

    // Snapshot not yet built (or corrupt) — fall back to live enrichment
    const [enrichedConfigurator, shop] = await Promise.all([
      admin
        ? enrichConfiguratorWithShopifyData(admin, lookup.configurator)
        : Promise.resolve(lookup.configurator),
      ensureShop(shopDomain),
    ]);

    const theme = await getShopThemeSettings(shop.id);

    const responseData = { configurator: serializeConfiguratorPayload(enrichedConfigurator, theme) };
    setCachedProxyResponse(shopDomain, productId, responseData);

    return json(responseData, { headers: { ...PROXY_HEADERS, "X-Cache": "MISS" } });
  }

  if (path.startsWith("share/")) {
    const shareId = path.replace("share/", "");
    const saved = await getSavedConfiguration(shareId);
    if (!saved) return json({ error: "Not found" }, { status: 404 });

    const configurator = await getConfiguratorForProduct(
      shopDomain,
      saved.productId,
    );
    if (!configurator) return json({ error: "Not found" }, { status: 404 });

    // Serve the same enriched data the product page does: prefer the stored snapshot,
    // fall back to live enrichment. Serializing the raw configurator would leave the
    // string catalog (and images/variant IDs) empty in the restored modal.
    let serializedConfigurator: unknown;
    const snap = (configurator as typeof configurator & {
      enrichedSnapshot?: string | null;
    }).enrichedSnapshot;

    if (snap) {
      try {
        serializedConfigurator = (JSON.parse(snap) as { configurator: unknown }).configurator;
      } catch {
        // Corrupt snapshot — fall through to live enrichment.
      }
    }

    if (!serializedConfigurator) {
      let admin: Awaited<ReturnType<typeof unauthenticated.admin>>["admin"] | undefined;
      try {
        admin = (await unauthenticated.admin(shopDomain)).admin;
      } catch {
        // Live enrichment needs an installed session; without it we serve the raw config.
      }
      const shop = await ensureShop(shopDomain);
      const theme = await getShopThemeSettings(shop.id);
      const enriched = admin
        ? await enrichConfiguratorWithShopifyData(admin, configurator)
        : configurator;
      serializedConfigurator = serializeConfiguratorPayload(enriched, theme);
    }

    return json({
      configurator: serializedConfigurator,
      productId: saved.productId,
      selections: JSON.parse(saved.selections),
      addons: JSON.parse(saved.addons),
    });
  }

  return json({ status: "ok", app: "Proto Switcher Configurator" });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const shopDomain = await resolveShopDomain(request);
  if (!shopDomain) {
    return json({ error: "Missing shop parameter" }, { status: 400 });
  }

  const shop = await ensureShop(shopDomain);
  const path = params["*"] ?? "";
  const body = await request.json().catch(() => ({}));

  if (path === "analytics") {
    await trackAnalyticsEvent({
      shopId: shop.id,
      eventType: sanitizeInput(String(body.eventType ?? "unknown"), 50),
      productId: body.metadata?.productId
        ? sanitizeInput(String(body.metadata.productId), 50)
        : undefined,
      sessionId: body.metadata?.sessionId
        ? sanitizeInput(String(body.metadata.sessionId), 100)
        : undefined,
      metadata: body.metadata ?? {},
    });
    return json({ ok: true });
  }

  if (path === "save") {
    const saved = await saveConfiguration({
      configuratorId: sanitizeInput(String(body.configuratorId ?? ""), 50),
      productId: sanitizeInput(String(body.productId ?? ""), 50),
      selections: body.selections ?? {},
      addons: body.addons ?? {},
      totalPrice: Number(body.totalPrice) || 0,
    });

    const shareUrl = `${new URL(request.url).origin}/products/${body.productId}?proto_config=${saved.shareId}`;

    return json({ shareId: saved.shareId, shareUrl });
  }

  return json({ error: "Not found" }, { status: 404 });
};
