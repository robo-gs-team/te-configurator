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
  const properties =
    stringing && usesStringingUi(configurator)
      ? buildStringingProperties(
          configurator,
          stringing.mode,
          stringing.standardBed,
          stringing.hybridBeds,
        )
      : buildLineItemProperties(configurator, selections, addonSelections);

  const mainVariantId = variantId || getProductVariantFromPage();
  if (!mainVariantId) {
    return { success: false, error: "No variant selected" };
  }

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

  for (const addon of configurator.addons) {
    const qty = addonSelections[addon.id] ?? 0;
    if (qty > 0 && addon.variantId) {
      items.push({
        id: Number(addon.variantId),
        quantity: qty,
        properties: { _parent_configurator: configurator.id },
      });
    }
  }

  try {
    const res = await fetch("/cart/add.js", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return {
        success: false,
        error: (err as { description?: string }).description || "Cart error",
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

function getProductVariantFromPage(): string | null {
  const form = document.querySelector('form[action*="/cart/add"]');
  const input = form?.querySelector<HTMLInputElement>(
    'input[name="id"], select[name="id"]',
  );
  return input?.value ?? null;
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
