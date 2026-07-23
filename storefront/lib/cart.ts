/**
 * cart.ts
 *
 * The Add-to-Cart layer: turns the shopper's configuration into Shopify cart line items and
 * POSTs them to the standard /cart/add.js endpoint. Also hosts the share-save and analytics
 * fetch helpers (both hit the App Proxy).
 *
 * The configuration travels to Shopify as LINE-ITEM PROPERTIES (not metafields) — see
 * stringing-cart.ts#buildStringingProperties for the exact keys. The cart can contain up to
 * three kinds of line: the racquet (with all string specs), an optional labor/service line,
 * and any add-on lines.
 */

import { buildLineItemProperties } from "~/lib/conditional-logic";
import type {
  SelectionState,
  StorefrontConfigurator,
} from "~/lib/configurator.types";
import type { BedSelection } from "./string-catalog";
import {
  getStringById,
  resolveStringCatalog,
  resolveStringVariantId,
  usesStringingUi,
} from "./string-catalog";
import { buildStringingProperties } from "./stringing-cart";
import type { StringingMode } from "../store/configurator-store";

/** Result of an add-to-cart attempt. `error` is a shopper-facing message when success is false. */
export type CartAddResult = {
  success: boolean;
  error?: string;
};

const STRUNG_ID_STORAGE_KEY = "proto_strung_id_counter";
const SESSION_ID_STORAGE_KEY = "proto_session_id";

/**
 * Stable id for this browsing session, created once and reused for every analytics event AND
 * stamped onto the order (as the hidden `_proto_session` line-item property) so the orders/create
 * webhook can tie a placed order back to the same session that opened the modal and added to cart —
 * giving a real open → add-to-cart → purchase funnel. sessionStorage-scoped (per tab/session);
 * falls back to an ephemeral id if storage is unavailable.
 */
function getOrCreateSessionId(): string {
  try {
    let id = window.sessionStorage.getItem(SESSION_ID_STORAGE_KEY);
    if (!id) {
      id = `s_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
      window.sessionStorage.setItem(SESSION_ID_STORAGE_KEY, id);
    }
    return id;
  } catch {
    return `s_${Math.random().toString(36).slice(2, 12)}`;
  }
}

/**
 * Sequential, human-readable id ("A1", "A2", ...) shared by every cart line produced by ONE
 * add-to-cart call for a stringing job (racquet, string bed(s), labor, addons) — the only thing
 * that ties a given string back to the racquet it goes with when an order has multiple strung
 * racquets. Backed by a counter in sessionStorage, scoped to this browser tab's session: NOT
 * globally unique by design. It survives full-page navigation (so racquet #2 on a different
 * product page continues the sequence), but resets in a new tab and when the session ends —
 * accepted, since this is a fulfillment/readability aid, not an id used anywhere programmatically.
 */
function generateStrungId(): string {
  let next = 1;
  try {
    const raw = window.sessionStorage.getItem(STRUNG_ID_STORAGE_KEY);
    const parsed = raw ? parseInt(raw, 10) : 0;
    next = Number.isFinite(parsed) && parsed > 0 ? parsed + 1 : 1;
    window.sessionStorage.setItem(STRUNG_ID_STORAGE_KEY, String(next));
  } catch {
    // sessionStorage unavailable (privacy mode, storage disabled, etc.) — fall back to a random
    // 2-digit suffix so pairing still works within this one add-to-cart call, just without
    // cross-job sequencing across the browsing session.
    next = Math.floor(Math.random() * 90) + 10;
  }
  return `A${next}`;
}

/**
 * Append a cart line for a variant, if the variant id is present. No-op when variantId is
 * null/undefined (e.g. an unconfigured labor variant), so callers don't need to null-check.
 * @param items The line-item array being built (mutated in place).
 * @param variantId Shopify variant id as a string, or null/undefined to skip.
 * @param quantity Quantity for this line.
 * @param properties Line-item properties to attach.
 */
function pushVariantLine(
  items: Array<{
    id: number;
    quantity: number;
    properties?: Record<string, string>;
  }>,
  variantId: string | null | undefined,
  quantity: number,
  properties: Record<string, string>,
) {
  if (!variantId) return;
  items.push({
    id: Number(variantId),
    quantity,
    properties,
  });
}

/**
 * Build and submit the cart for a completed configuration.
 *
 * For the stringing UI it assembles: (1) the racquet variant carrying the full spec as line-item
 * properties; (2) one line per selected string variant (standard = one, hybrid = mains + crosses),
 * tagged `_line_type: string` — so the cart total matches the modal's racquet + string(s) + labor
 * breakdown; (3) the optional labor/service line, tagged `_line_type: labor`; (4) one line per
 * selected add-on. Every line from a stringing add gets the same "Strung ID" property, so an order
 * with multiple strung racquets still shows which string belongs to which racquet. For the generic
 * UI it's the racquet line + add-ons (no Strung ID — there's nothing to disambiguate). Posts all
 * lines in one /cart/add.js request, then fires cart events and opens the drawer.
 *
 * @param variantId Racquet variant id; falls back to reading it from the page if null.
 * @param stringing Present only when the stringing UI is in use; carries mode + bed selections.
 * @returns success, or success:false with a shopper-facing error.
 */
export async function addToShopifyCart(
  configurator: StorefrontConfigurator,
  selections: SelectionState,
  addonSelections: Record<string, number>,
  variantId: string | null,
  productId: string,
  quantity = 1,
  stringing?: {
    mode: StringingMode;
    standardBed: BedSelection;
    hybridBeds: { mains: BedSelection; crosses: BedSelection };
  },
): Promise<CartAddResult> {
  const isStringing = Boolean(stringing && usesStringingUi(configurator));
  const properties = isStringing
    ? buildStringingProperties(
        configurator,
        stringing!.mode,
        stringing!.standardBed,
        stringing!.hybridBeds,
      )
    : buildLineItemProperties(configurator, selections, addonSelections);

  const mainVariantId = variantId || getProductVariantFromPage();
  if (!mainVariantId) {
    return { success: false, error: "No variant selected" };
  }

  // One id per stringing job, stamped on every line this call produces (racquet, string(s),
  // labor, addons) so multiple strung racquets in one order stay disambiguated. Not applied to
  // the generic (non-stringing) flow — a single racquet + addons has nothing to disambiguate.
  // Customer-visible (no leading underscore) by design: the shopper should be able to see which
  // string lines belong to which racquet in their own cart/checkout/receipt, not just staff on
  // the Shopify Admin order page.
  const sessionId = getOrCreateSessionId();
  const strungId = isStringing ? generateStrungId() : null;
  // Staff-only session stamp (leading underscore) so the orders/create webhook can attribute the
  // placed order back to this browsing session for the analytics funnel.
  const parentTag: Record<string, string> = {
    _parent_configurator: configurator.id,
    _proto_session: sessionId,
  };
  if (strungId) parentTag["Strung ID"] = strungId;

  const racquetProps: Record<string, string> = { ...properties, _proto_session: sessionId };
  if (strungId) racquetProps["Strung ID"] = strungId;

  const items: Array<{
    id: number;
    quantity: number;
    properties?: Record<string, string>;
  }> = [
    {
      id: Number(mainVariantId),
      quantity,
      properties: racquetProps,
    },
  ];

  if (isStringing && stringing) {
    // Charge the selected string(s) as their own cart line(s) so the cart total matches the
    // modal's breakdown (racquet + string(s) + labor). Standard = the one bed's string; hybrid =
    // the mains + crosses strings. The racquet line still carries the full spec as properties.
    const catalog = resolveStringCatalog(configurator);
    const stringBeds =
      stringing.mode === "standard"
        ? [{ bed: stringing.standardBed, side: "" }]
        : [
            { bed: stringing.hybridBeds.mains, side: "Mains" },
            { bed: stringing.hybridBeds.crosses, side: "Crosses" },
          ];
    for (const { bed, side } of stringBeds) {
      const stringProduct = getStringById(catalog, bed.stringId);
      // Charge the exact variant matching the shopper's gauge+color (falling back sensibly), not a
      // fixed first variant — that's what caused in-stock strings to fail as "already sold out".
      const stringVariantId = resolveStringVariantId(stringProduct, bed.gauge, bed.color);
      pushVariantLine(items, stringVariantId, 1, {
        ...parentTag,
        _line_type: "string",
        // Staff-only (leading underscore) — the racquet line's own (customer-visible)
        // Mains/Crosses summary already tells the shopper which side is which, so the string
        // line itself only surfaces "Strung ID" to the customer; everything else here (side,
        // gauge, color, tension) is fulfillment detail for whoever strings it.
        ...(side ? { _Position: side } : {}),
        _Gauge: `${bed.gauge}g`,
        _Color: bed.color,
        _Tension: `${bed.tension} lbs`,
      });
    }

    // The optional labor/stringing service.
    if (configurator.laborVariantId) {
      pushVariantLine(items, configurator.laborVariantId, 1, {
        ...parentTag,
        _line_type: "labor",
      });
    }
  }

  for (const addon of configurator.addons) {
    const qty = addonSelections[addon.id] ?? 0;
    if (qty > 0 && addon.variantId) {
      items.push({
        id: Number(addon.variantId),
        quantity: qty,
        properties: parentTag,
      });
    }
  }

  try {
    const res = await postCartItems(items);

    if (!res.ok) {
      // Read as text first — Shopify's /cart/add.js error body is usually JSON with
      // description/message, but a proxy/WAF failure can return HTML or an empty body. Falling
      // back to the raw text (rather than a generic "Cart error") keeps the real reason visible
      // instead of masking it.
      const rawText = await res.text().catch(() => "");
      let parsed: { description?: string; message?: string } = {};
      try {
        parsed = rawText ? JSON.parse(rawText) : {};
      } catch {
        /* not JSON — fall through to rawText below */
      }
      const detail = parsed.description ?? parsed.message;
      const trimmedText = rawText.trim();
      // Only surface the raw body as a last resort, and only when it looks like a short plain-text
      // reason rather than an HTML error page (e.g. from a proxy/WAF), which would be unreadable.
      const usableRawText =
        trimmedText.length > 0 && trimmedText.length < 300 && !trimmedText.startsWith("<")
          ? trimmedText
          : null;
      return {
        success: false,
        error: detail || usableRawText || `Cart error (${res.status})`,
      };
    }

    document.dispatchEvent(new CustomEvent("cart:refresh"));
    document.dispatchEvent(new CustomEvent("proto:cart-added"));

    const cartDrawer = document.querySelector("cart-drawer") as
      | (HTMLElement & { open?: () => void })
      | null;
    if (cartDrawer?.open) cartDrawer.open();

    return { success: true };
  } catch {
    return { success: false, error: "Network error" };
  }
}

/** POST a set of line items to Shopify's Ajax cart endpoint. @returns the raw fetch Response. */
async function postCartItems(
  items: Array<{
    id: number;
    quantity: number;
    properties?: Record<string, string>;
  }>,
) {
  return fetch("/cart/add.js", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
}

/**
 * Best-effort discovery of the currently selected racquet variant id from the page, used when
 * the caller didn't pass one. Tries, in order: reading `id` from the actual cart-add form via
 * FormData, the product form's `id` input/select by direct selector, a
 * `[data-selected-variant-id]` element, the `?variant=` URL param, then the embedded product
 * JSON (selected or first variant).
 * @returns The variant id as a string, or null if none could be determined.
 */
function getProductVariantFromPage(): string | null {
  // Prefer FormData over querying a specific input/select type directly — themes vary widely in
  // how they implement variant pickers (radio button groups, custom web components wrapping a
  // native control, etc.), but ANY of them must ultimately expose a `name="id"` form control for
  // the theme's own native Add to Cart to work at all. FormData correctly aggregates whichever
  // control type holds that value (including ones associated via a `form="..."` attribute rather
  // than DOM nesting), so it captures exactly what the theme's own submission would use.
  const cartForm =
    document.querySelector<HTMLFormElement>('form[action*="/cart/add"]') ??
    document.querySelector<HTMLFormElement>("product-form form");
  if (cartForm) {
    const id = new FormData(cartForm).get("id");
    if (id) return String(id);
  }

  const selectors = [
    'form[action*="/cart/add"] input[name="id"]',
    'form[action*="/cart/add"] select[name="id"]',
    'product-form input[name="id"]',
    'product-form select[name="id"]',
    'input[name="id"][form*="product"]',
    'select[name="id"][form*="product"]',
  ];

  for (const selector of selectors) {
    const input = document.querySelector<HTMLInputElement | HTMLSelectElement>(
      selector,
    );
    if (input?.value) return input.value;
  }

  const variantPicker = document.querySelector<HTMLElement>(
    "[data-selected-variant-id]",
  );
  if (variantPicker?.dataset.selectedVariantId) {
    return variantPicker.dataset.selectedVariantId;
  }

  const urlVariant = new URLSearchParams(window.location.search).get("variant");
  if (urlVariant) return urlVariant;

  const productJson = document.querySelector<HTMLScriptElement>(
    'script[type="application/json"][data-product-json], script[type="application/json"][id*="ProductJson"]',
  );
  if (productJson?.textContent) {
    try {
      const data = JSON.parse(productJson.textContent) as {
        selected_or_first_available_variant?: { id?: number | string };
        variants?: Array<{ id?: number | string }>;
      };
      const selected = data.selected_or_first_available_variant?.id;
      if (selected != null) return String(selected);
      const first = data.variants?.[0]?.id;
      if (first != null) return String(first);
    } catch {
      /* ignore malformed JSON */
    }
  }

  return null;
}

/**
 * Best-effort read of the current racquet's price from the product page, so the configurator's
 * "Racquet" line and total reflect the real product price rather than a manually-entered value.
 * Reads the selected/first variant's price from the embedded product JSON (Shopify prices are in
 * cents), falling back to a `[data-selected-variant-price]` element. Returns null if unavailable,
 * so the caller can fall back to the configurator's stored base price.
 */
export function getProductPriceFromPage(): number | null {
  const currentVariantId = getProductVariantFromPage();

  // 1. Embedded product JSON (Dawn & many themes). Prices are in cents. Prefer the currently
  //    selected variant, then selected_or_first_available, then the first variant.
  const productJson = document.querySelector<HTMLScriptElement>(
    'script[type="application/json"][data-product-json], script[type="application/json"][id*="ProductJson"]',
  );
  if (productJson?.textContent) {
    try {
      const data = JSON.parse(productJson.textContent) as {
        selected_or_first_available_variant?: { id?: number | string; price?: number | string };
        variants?: Array<{ id?: number | string; price?: number | string }>;
      };
      const match = currentVariantId
        ? data.variants?.find((v) => String(v.id) === String(currentVariantId))
        : undefined;
      const raw =
        match?.price ??
        data.selected_or_first_available_variant?.price ??
        data.variants?.[0]?.price;
      const cents = Number(raw);
      if (Number.isFinite(cents) && cents > 0) return cents / 100;
    } catch {
      /* ignore malformed JSON */
    }
  }

  // 2. window.ShopifyAnalytics.meta.product — present on almost every Shopify storefront. Prices
  //    are in cents; match the selected variant when we know it.
  try {
    const meta = (
      window as unknown as {
        ShopifyAnalytics?: { meta?: { product?: { variants?: Array<{ id?: number | string; price?: number | string }> } } };
      }
    ).ShopifyAnalytics?.meta?.product;
    const variants = meta?.variants;
    if (variants?.length) {
      const match = currentVariantId
        ? variants.find((v) => String(v.id) === String(currentVariantId))
        : undefined;
      const cents = Number((match ?? variants[0])?.price);
      if (Number.isFinite(cents) && cents > 0) return cents / 100;
    }
  } catch {
    /* ignore */
  }

  // 3. A data attribute some themes expose (cents).
  const priceEl = document.querySelector<HTMLElement>("[data-selected-variant-price]");
  const attr = priceEl?.dataset.selectedVariantPrice;
  if (attr) {
    const cents = Number(attr);
    if (Number.isFinite(cents) && cents > 0) return cents / 100;
  }

  // 4. og:price / itemprop=price meta (usually already in dollars).
  const metaPrice =
    document.querySelector<HTMLMetaElement>('meta[property="og:price:amount"]')?.content ??
    document.querySelector<HTMLMetaElement>('meta[itemprop="price"]')?.content;
  if (metaPrice) {
    const dollars = Number(metaPrice);
    if (Number.isFinite(dollars) && dollars > 0) return dollars;
  }

  return null;
}

/**
 * Persist the current configuration via the App Proxy (`POST /save`) so it can be shared.
 * @returns The share URL on success, or null on failure (network or non-OK response).
 */
export async function saveConfiguration(
  appProxyUrl: string,
  data: {
    configuratorId: string;
    productId: string;
    selections: SelectionState;
    addons: Record<string, number>;
    totalPrice: number;
  },
): Promise<string | null> {
  try {
    const res = await fetch(`${appProxyUrl}/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { shareUrl?: string };
    return json.shareUrl ?? null;
  } catch {
    return null;
  }
}

/** Coarse device bucket for the analytics device split — matches the modal's own 768px breakpoint. */
function getDevice(): "mobile" | "desktop" {
  try {
    return window.matchMedia("(max-width: 767px)").matches ? "mobile" : "desktop";
  } catch {
    return "desktop";
  }
}

/**
 * Fire-and-forget analytics event to the App Proxy (`POST /analytics`). Never throws and never
 * blocks the UI — failures are swallowed. Events: modal_open, add_to_cart, share (purchase is
 * recorded server-side by the orders/create webhook). Every event carries sessionId + device.
 */
export async function trackEvent(
  appProxyUrl: string,
  eventType: string,
  metadata: Record<string, unknown> = {},
) {
  try {
    await fetch(`${appProxyUrl}/analytics`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Stamp the session id on every event (unless a caller already set one) so the dashboard can
      // count unique sessions per funnel stage and join to purchases from the orders webhook.
      body: JSON.stringify({
        eventType,
        metadata: { sessionId: getOrCreateSessionId(), device: getDevice(), ...metadata },
      }),
    });
  } catch {
    /* non-blocking */
  }
}
