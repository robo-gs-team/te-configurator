/**
 * theme-buybox.ts
 *
 * Hides the theme's "Buy now" / accelerated-checkout buttons while the shopper has "Strung"
 * selected. Rationale: a strung racquet must go through the configurator + Add to Cart flow
 * (which adds the racquet + labor lines), so letting the customer one-click Buy Now would
 * bypass stringing. The quantity selector and normal Add to Cart are intentionally left
 * alone (Add to Cart is handled separately in configure-placement.ts).
 *
 * State is held in module-level variables so the exact elements hidden can be restored
 * later. NOTE (fragility): these records live only in this module's memory — if the theme
 * re-renders the buy box (e.g. on variant change), the recorded elements become stale and
 * restoration can silently fail. This is part of the known DOM-surgery fragility.
 */

/** A single hidden element plus its original inline `display` value, so it can be restored. */
type HiddenRecord = {
  el: HTMLElement;
  display: string;
};

/** The elements currently hidden by setThemeBuyBoxHidden(true), with their prior display values. */
let hiddenRecords: HiddenRecord[] = [];
/** Whether the buy box is currently hidden — guards against redundant hide/show work. */
let isBuyBoxHidden = false;

/**
 * @returns true if the element is part of (or contains) the app's own configurator UI —
 *   used to avoid ever hiding our own button when scanning for theme buttons to hide.
 */
function isProtoElement(el: Element | null): boolean {
  if (!el) return false;
  if (el.closest(".proto-configurator-button-wrapper")) return true;
  if (el.closest(".proto-configurator-actions")) return true;
  if (el.querySelector?.(".proto-configurator-button-wrapper")) return true;
  return false;
}

/**
 * @returns true if this element is safe to hide — i.e. it is not the app's own UI and does
 *   not contain the app's button wrapper.
 */
function canHideElement(el: HTMLElement): boolean {
  if (isProtoElement(el)) return false;
  return !el.querySelector(".proto-configurator-button-wrapper");
}

/**
 * Locate the product's add-to-cart form (Dawn-style `<product-form>` first, then any form
 * posting to /cart/add).
 *
 * NOTE: currently unused within this module; retained as a helper/anchor for buy-box scans.
 * @returns The form element, or null if not found.
 */
function getProductForm(): Element | null {
  return (
    document.querySelector("product-form form") ??
    document.querySelector('form[action*="/cart/add"]')
  );
}

/**
 * Scan the page for "Buy now" / accelerated-checkout / express-checkout buttons that are
 * safe to hide. Matches several known theme selectors and filters out the app's own UI.
 * @returns The matching checkout elements (may be empty).
 */
function findCheckoutElements(): HTMLElement[] {
  const found: HTMLElement[] = [];
  const buyNowSelectors = [
    ".shopify-payment-button",
    "shopify-accelerated-checkout",
    ".shopify-buy-it-now-button",
    ".product-form__checkout",
    'button[name="checkout"]',
    '[data-shopify="payment-button"]',
  ];

  for (const selector of buyNowSelectors) {
    document.querySelectorAll(selector).forEach((node) => {
      if (node instanceof HTMLElement && canHideElement(node)) {
        found.push(node);
      }
    });
  }

  return found;
}

/**
 * Hide or restore the theme's Buy now / accelerated-checkout buttons.
 *
 * Hiding: records each checkout element's current inline `display`, forces `display:none`,
 * marks it hidden, and adds `proto-stringing-strung` to <body> (a CSS fallback hook used by
 * configurator-embed.liquid). Restoring: puts every recorded element's display back and
 * clears the records. The `isBuyBoxHidden` guard makes repeated same-state calls cheap
 * (though a redundant `false` call still ensures the body class is removed).
 *
 * @param hidden true to hide the buy box, false to restore it.
 */
export function setThemeBuyBoxHidden(hidden: boolean) {
  if (hidden === isBuyBoxHidden) {
    if (!hidden) {
      document.body.classList.remove("proto-stringing-strung");
    }
    return;
  }
  isBuyBoxHidden = hidden;

  if (hidden) {
    hiddenRecords = findCheckoutElements().map((el) => {
      const display = el.style.display;
      el.style.setProperty("display", "none", "important");
      el.setAttribute("aria-hidden", "true");
      el.dataset.protoHidden = "true";
      return { el, display };
    });
    document.body.classList.add("proto-stringing-strung");
    return;
  }

  hiddenRecords.forEach(({ el, display }) => {
    if (display) {
      el.style.display = display;
    } else {
      el.style.removeProperty("display");
    }
    el.removeAttribute("aria-hidden");
    delete el.dataset.protoHidden;
  });
  hiddenRecords = [];
  document.body.classList.remove("proto-stringing-strung");
}

/**
 * Re-apply buy-box hiding from scratch, discarding stale records.
 *
 * Use this (instead of setThemeBuyBoxHidden(true)) when the buy box may already be hidden
 * but the DOM has since changed — e.g. the theme re-rendered after a variant change, so the
 * previously-recorded elements are stale. It force-clears the old records, then hides afresh
 * against the current DOM. When `hidden` is false it simply delegates to a normal restore.
 *
 * @param hidden true to re-hide against the current DOM, false to restore.
 */
export function refreshThemeBuyBoxHidden(hidden: boolean) {
  if (!hidden) {
    setThemeBuyBoxHidden(false);
    return;
  }

  isBuyBoxHidden = false;
  hiddenRecords.forEach(({ el, display }) => {
    if (display) el.style.display = display;
    else el.style.removeProperty("display");
    el.removeAttribute("aria-hidden");
    delete el.dataset.protoHidden;
  });
  hiddenRecords = [];
  document.body.classList.remove("proto-stringing-strung");
  setThemeBuyBoxHidden(true);
}
