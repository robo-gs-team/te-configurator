/**
 * product-linkage.ts
 *
 * Tracks whether the current product is "linked" to a configurator, and reflects that
 * state onto the <html> element as a CSS class. The classes drive the button's visibility
 * BEFORE and AFTER the linkage check completes (see the matching rules in
 * configurator-embed.liquid / styles.css):
 *
 *   html.proto-configurator-pending   → button wrapper is `visibility:hidden` (don't flash
 *                                        a Configure button before we know it belongs here)
 *   html.proto-configurator-linked    → (no hide rule) button is allowed to show
 *   html.proto-configurator-unlinked  → button wrapper is `display:none !important` (gone)
 *
 * Exactly one of the three classes is present at a time. The flow is:
 * pending (on load) → linked OR unlinked (after the proxy responds).
 */

import { normalizeProductId } from "./product-id";
import { restoreAddToCartButtons } from "./configure-placement";
import { setThemeBuyBoxHidden } from "./theme-buybox";

/**
 * Resolve the current page's Shopify product id from the most reliable source available.
 *
 * Tries, in order: the embed's `window.ProtoConfiguratorSettings.productId`, any element
 * with `data-product-id`, then the Configure trigger's own `data-product-id`. All results
 * are normalized (gid:// prefixes stripped) so callers get a bare numeric id.
 *
 * @returns The normalized product id, or null if none could be found (e.g. not a product page).
 */
export function getPageProductId(): string | null {
  const fromSettings = window.ProtoConfiguratorSettings?.productId;
  if (fromSettings) return normalizeProductId(fromSettings);

  const fromDom = document.querySelector<HTMLElement>("[data-product-id]")?.dataset.productId;
  if (fromDom) return normalizeProductId(fromDom);

  const fromTrigger = document.querySelector<HTMLElement>(
    "[data-proto-configurator-trigger]",
  )?.dataset.productId;
  if (fromTrigger) return normalizeProductId(fromTrigger);

  return null;
}

/**
 * Mark linkage as "still being determined": adds `proto-configurator-pending` and clears
 * the linked/unlinked classes. Called at the very start of the linkage check so the button
 * stays hidden (visibility:hidden) until we know whether this product has a configurator.
 */
export function markProductLinkagePending() {
  document.documentElement.classList.add("proto-configurator-pending");
  document.documentElement.classList.remove(
    "proto-configurator-linked",
    "proto-configurator-unlinked",
  );
}

/**
 * Mark the product as linked to an active configurator: the Configure button is allowed
 * to show. Called when the proxy returns a configurator for this product.
 */
export function markProductLinked() {
  document.documentElement.classList.remove(
    "proto-configurator-pending",
    "proto-configurator-unlinked",
  );
  document.documentElement.classList.add("proto-configurator-linked");
}

/**
 * Mark the product as NOT linked (no configurator, or it's inactive): the Configure button
 * is hidden via `display:none`. Also undoes any buy-box suppression — since there's no
 * configurator here, the theme's native Add to Cart / Buy Now must be restored so the
 * product remains purchasable normally.
 */
export function markProductUnlinked() {
  document.documentElement.classList.remove(
    "proto-configurator-pending",
    "proto-configurator-linked",
  );
  document.documentElement.classList.add("proto-configurator-unlinked");
  setThemeBuyBoxHidden(false);
  restoreAddToCartButtons();
}
