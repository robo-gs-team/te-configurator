import { buildLineItemProperties } from "~/lib/conditional-logic";
import type {
  SelectionState,
  StorefrontConfigurator,
} from "~/lib/configurator.types";
import type { BedSelection } from "./string-catalog";
import { usesStringingUi } from "./string-catalog";
import { buildStringingProperties } from "./stringing-cart";
import type { StringingMode } from "../store/configurator-store";

export type CartAddResult = {
  success: boolean;
  error?: string;
};

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
    let res = await postCartItems(items);

    if (!res.ok && isStringing && items.length > 1) {
      res = await postCartItems([items[0]]);
    }

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

function getProductVariantFromPage(): string | null {
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
