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
import { usesStringingUi } from "./string-catalog";
import { buildStringingProperties } from "./stringing-cart";
import type { StringingMode } from "../store/configurator-store";

/** Result of an add-to-cart attempt. `error` is a shopper-facing message when success is false. */
export type CartAddResult = {
  success: boolean;
  error?: string;
};

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
 * Assembles up to three kinds of line: (1) the racquet variant carrying all configuration as
 * line-item properties — stringing specs for the stringing UI, or generic selection properties
 * otherwise; (2) the optional labor/service line (stringing only), tagged `_line_type: labor`
 * + `_parent_configurator`; (3) one line per selected add-on, tagged `_parent_configurator`.
 * Posts all lines in one /cart/add.js request, then fires cart events and opens the drawer.
 *
 * GOTCHA (known v1 bug): on a failed multi-line POST for stringing it retries with ONLY the
 * racquet line and still returns success — silently dropping the labor line. v2 should surface
 * a real error instead (see HOW_IT_WORKS_ON_SITE.md / V2_PLAN.md).
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

  const parentTag = { _parent_configurator: configurator.id };
  const items: Array<{
    id: number;
    quantity: number;
    properties?: Record<string, string>;
  }> = [
    {
      id: Number(mainVariantId),
      quantity,
      properties,
    },
  ];

  if (isStringing && stringing) {
    // String SKUs are catalog references — selections are stored on the racket line.
    // Only the optional labor service is added as a separate cart line.
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
      const err = await res.json().catch(() => ({}));
      return {
        success: false,
        error: (err as { description?: string; message?: string }).description
          ?? (err as { message?: string }).message
          ?? "Cart error",
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
  const productJson = document.querySelector<HTMLScriptElement>(
    'script[type="application/json"][data-product-json], script[type="application/json"][id*="ProductJson"]',
  );
  if (productJson?.textContent) {
    try {
      const data = JSON.parse(productJson.textContent) as {
        selected_or_first_available_variant?: { price?: number | string };
        variants?: Array<{ price?: number | string }>;
      };
      const raw =
        data.selected_or_first_available_variant?.price ?? data.variants?.[0]?.price;
      if (raw != null) {
        const cents = Number(raw);
        if (Number.isFinite(cents)) return cents / 100;
      }
    } catch {
      /* ignore malformed JSON */
    }
  }

  const priceEl = document.querySelector<HTMLElement>("[data-selected-variant-price]");
  const attr = priceEl?.dataset.selectedVariantPrice;
  if (attr) {
    const cents = Number(attr);
    if (Number.isFinite(cents)) return cents / 100;
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

/**
 * Fire-and-forget analytics event to the App Proxy (`POST /analytics`). Never throws and never
 * blocks the UI — failures are swallowed. In v1 only `modal_open` and `add_to_cart` are sent.
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
      body: JSON.stringify({ eventType, metadata }),
    });
  } catch {
    /* non-blocking */
  }
}
