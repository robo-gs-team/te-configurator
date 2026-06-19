import { buildLineItemProperties } from "~/lib/conditional-logic";
import type {
  SelectionState,
  StorefrontConfigurator,
} from "~/lib/configurator.types";
import type { BedSelection } from "./string-catalog";
import {
  getStringById,
  resolveStringCatalog,
  usesStringingUi,
} from "./string-catalog";
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
    const catalog = resolveStringCatalog(configurator);

    if (stringing.mode === "standard") {
      const stringProduct = getStringById(catalog, stringing.standardBed.stringId);
      pushVariantLine(items, stringProduct?.variantId, 1, {
        ...parentTag,
        _line_type: "string",
        String: stringProduct?.name ?? "",
      });
    } else {
      const mains = getStringById(catalog, stringing.hybridBeds.mains.stringId);
      const crosses = getStringById(catalog, stringing.hybridBeds.crosses.stringId);
      pushVariantLine(items, mains?.variantId, 1, {
        ...parentTag,
        _line_type: "string_mains",
        String: mains?.name ?? "",
      });
      pushVariantLine(items, crosses?.variantId, 1, {
        ...parentTag,
        _line_type: "string_crosses",
        String: crosses?.name ?? "",
      });
    }

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
