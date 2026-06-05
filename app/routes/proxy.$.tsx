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
import { normalizeProductId } from "~/lib/product-id";
import { authenticate } from "~/shopify.server";

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
    const lookup = await lookupConfiguratorForProduct(shopDomain, productId);

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
          "No configurator linked to this product ID. Add the numeric product ID in the app admin and click Save changes.",
        productId,
        code: "not_linked",
      });
    }

    const configurator = lookup.configurator;

    const shop = await ensureShop(shopDomain);
    const theme = await getShopThemeSettings(shop.id);

    return json(
      { configurator: serializeConfiguratorPayload(configurator, theme) },
      {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=60",
        },
      },
    );
  }

  if (path.startsWith("share/")) {
    const shareId = path.replace("share/", "");
    const saved = await getSavedConfiguration(shareId);
    if (!saved) return json({ error: "Not found" }, { status: 404 });

    const shop = await ensureShop(shopDomain);
    const configurator = await getConfiguratorForProduct(
      shopDomain,
      saved.productId,
    );
    if (!configurator) return json({ error: "Not found" }, { status: 404 });

    const theme = await getShopThemeSettings(shop.id);

    return json({
      configurator: serializeConfiguratorPayload(configurator, theme),
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
