/**
 * theme-placement.ts
 *
 * Relocates the app's configurator wrapper into the right spot inside an ARBITRARY merchant
 * theme's product page, and hides the theme's own "Choose Your Stringing" field if present.
 *
 * Because every theme has different markup, this works by heuristics: long lists of known
 * selectors for the buy box, the insertion point, and the theme's stringing field, plus a
 * text-based scan for the literal label "choose your stringing". This is inherently fragile —
 * a theme that renames the label, localizes the store, or uses non-standard markup can defeat
 * the heuristics. This module is the main reason placement is the "clunky" part of the app.
 *
 * Two placement strategies, tried in order by `moveWrapper`:
 *   1. relocateToStringingSlot — put our wrapper where the theme's stringing field is, and
 *      hide that field (preferred: matches the merchant's intended position).
 *   2. relocateToBuyBox — otherwise, insert into the theme's buy box before the cart controls.
 */

/** The theme stringing field is detected by matching this (normalized) label text. */
const STRINGING_LABEL = "choose your stringing";

/** Candidate selectors for the product "buy box" container, tried in order. */
const PRODUCT_BUY_BOX_SELECTORS = [
  "product-form",
  'form[action*="/cart/add"]',
  ".product-form",
  ".product-info__buy-box",
  ".product__buy-buttons",
  "[data-product-form]",
  ".product-form__buttons",
];

/** Candidate selectors for the element to insert our wrapper BEFORE inside the buy box. */
const INSERT_BEFORE_SELECTORS = [
  ".product-form__quantity",
  "quantity-input",
  ".quantity-selector",
  ".product-form__buttons",
  "button[name='add']",
  ".product-form__submit",
  "[data-add-to-cart]",
  "#ProductSubmitButton",
  ".shopify-payment-button",
  "shopify-accelerated-checkout",
];

/** Candidate container selectors that might wrap the theme's stringing label/field. */
const THEME_STRINGING_FIELD_SELECTORS = [
  "[class*='shopify-block']",
  "[id*='shopify-block']",
  "[data-block-type]",
  ".product-form__input",
  ".product-form__item",
  ".product-info__block",
  ".product__block",
  ".fieldset",
  "fieldset",
  ".form-group",
  ".field",
  ".select-wrapper",
  ".variant-wrapper",
  ".custom-liquid",
  ".product-form__quantity",
];

/**
 * Find the product form element via common conventions (Dawn `<product-form>`, a /cart/add
 * form, `.product-form`, or `[data-product-form]`).
 * @returns The form element, or null.
 */
function findProductFormAnchor(): Element | null {
  return (
    document.querySelector("product-form") ??
    document.querySelector('form[action*="/cart/add"]') ??
    document.querySelector(".product-form") ??
    document.querySelector("[data-product-form]")
  );
}

/**
 * Find the container that represents the product buy box.
 *
 * Walks PRODUCT_BUY_BOX_SELECTORS (skipping anything inside our own wrapper) and returns the
 * matched element's PARENT (so we insert as a sibling of the form, not inside it). Falls back
 * to the product form's parent.
 * @returns The buy-box container, or null if none found.
 */
function findProductBuyBox(): HTMLElement | null {
  for (const selector of PRODUCT_BUY_BOX_SELECTORS) {
    const el = document.querySelector(selector);
    if (!(el instanceof HTMLElement)) continue;
    if (el.closest(".proto-configurator-button-wrapper")) continue;
    return el.parentElement instanceof HTMLElement ? el.parentElement : el;
  }

  const form = findProductFormAnchor();
  if (form?.parentElement instanceof HTMLElement) {
    return form.parentElement;
  }

  return null;
}

/** Normalize an element's text for comparison: trimmed, lower-cased, whitespace collapsed. */
function normalizeLabelText(el: Element): string {
  return el.textContent?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";
}

/** @returns true if the element's text equals or contains the "choose your stringing" label. */
function isStringingLabel(el: Element): boolean {
  const text = normalizeLabelText(el);
  return text === STRINGING_LABEL || text.includes(STRINGING_LABEL);
}

/**
 * Find the theme's own "Choose Your Stringing" block (Vision and similar themes).
 *
 * Scans all label-ish elements on the page for the stringing label text, then walks up to the
 * nearest containing field via THEME_STRINGING_FIELD_SELECTORS (or the label's parent as a
 * fallback). Skips anything inside our own wrapper. This is the text-heuristic that breaks if
 * the merchant renames or localizes the label.
 * @returns The theme stringing field container, or null if not found.
 */
function scanForThemeStringingBlock(): HTMLElement | null {
  const labels = document.querySelectorAll(
    "label, .form__label, legend, p, span, h3, h4, .label, .product-form__label",
  );

  for (const label of labels) {
    if (!(label instanceof HTMLElement)) continue;
    if (label.closest(".proto-configurator-button-wrapper")) continue;
    if (!isStringingLabel(label)) continue;

    for (const selector of THEME_STRINGING_FIELD_SELECTORS) {
      const field = label.closest(selector);
      if (
        field instanceof HTMLElement &&
        !field.closest(".proto-configurator-button-wrapper")
      ) {
        return field;
      }
    }

    const parent = label.parentElement;
    if (
      parent instanceof HTMLElement &&
      !parent.closest(".proto-configurator-button-wrapper")
    ) {
      return parent;
    }
  }

  return null;
}

// This scan walks every label-ish element in the whole document — the placement pipeline calls
// it several times per pass (relocation, gate init, gate apply), and nothing mutates the theme's
// own markup between those calls, so cache the result for the duration of one pass. Invalidated
// wherever a pass begins (see invalidateThemeBlockCache callers) so a genuinely new pass — a
// section reload, or the rAF-deferred second relocation attempt — always re-scans fresh.
let cachedThemeBlock: HTMLElement | null | undefined;

export function findThemeStringingBlock(): HTMLElement | null {
  if (cachedThemeBlock !== undefined) return cachedThemeBlock;
  cachedThemeBlock = scanForThemeStringingBlock();
  return cachedThemeBlock;
}

/**
 * Invalidate the cached theme-stringing-block lookup so the next call re-scans the live DOM.
 * Call this at the start of any placement pass that might see a changed DOM (page boot, a
 * `shopify:section:load` reload, or before the rAF-deferred relocation retry).
 */
export function invalidateThemeBlockCache() {
  cachedThemeBlock = undefined;
}

/** Hide a theme element (the native stringing field) and tag it so we know we hid it. */
function hideThemeElement(el: HTMLElement) {
  el.style.display = "none";
  el.setAttribute("aria-hidden", "true");
  el.dataset.protoThemeStringingHidden = "true";
}

/**
 * Within a buy-box container, find the first element our wrapper should be inserted before
 * (per INSERT_BEFORE_SELECTORS), skipping our own wrapper.
 * @returns The insertion anchor, or null.
 */
function findInsertPoint(container: HTMLElement): Element | null {
  for (const selector of INSERT_BEFORE_SELECTORS) {
    const el = container.querySelector(selector);
    if (el && !el.closest(".proto-configurator-button-wrapper")) return el;
  }
  return null;
}

/**
 * @returns true if `earlier` appears before `later` in document order. Used to check the
 *   wrapper is already positioned ahead of the theme field / cart controls (avoids redundant
 *   moves that could cause flicker).
 */
function isBeforeInDom(earlier: Element, later: Element): boolean {
  return Boolean(earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING);
}

/**
 * Decide whether the wrapper is already in the correct place, so we can skip re-inserting it.
 *
 * With a theme stringing block: correct means the block is already hidden by us AND the
 * wrapper sits before it. Without one: correct means the wrapper sits before the buy box's
 * insertion point.
 * @returns true if no move is needed.
 */
function isWrapperCorrectlyPlaced(
  wrapper: HTMLElement,
  themeBlock: HTMLElement | null,
): boolean {
  if (themeBlock) {
    if (themeBlock.dataset.protoThemeStringingHidden !== "true") return false;
    return isBeforeInDom(wrapper, themeBlock);
  }

  const buyBox = findProductBuyBox();
  if (!buyBox) return false;

  const insertBefore = findInsertPoint(buyBox);
  if (!insertBefore) return false;

  return isBeforeInDom(wrapper, insertBefore);
}

/**
 * Strategy 1: place the wrapper where the theme's stringing field is, then hide that field.
 * Only moves the wrapper if it isn't already correctly placed.
 * @returns true if a theme stringing block was found and used; false to let the caller try
 *   the buy-box strategy instead.
 */
function relocateToStringingSlot(wrapper: HTMLElement): boolean {
  const themeBlock = findThemeStringingBlock();
  if (!themeBlock?.parentElement) return false;

  if (!isWrapperCorrectlyPlaced(wrapper, themeBlock)) {
    themeBlock.parentElement.insertBefore(wrapper, themeBlock);
    wrapper.dataset.protoRelocated = "true";
  }

  hideThemeElement(themeBlock);
  return true;
}

/**
 * Strategy 2 (fallback): insert the wrapper into the buy box before the cart controls, or
 * prepend it to the buy box if no insertion point is found.
 * @returns true if a buy box was found (so the wrapper was placed); false otherwise.
 */
function relocateToBuyBox(wrapper: HTMLElement): boolean {
  const buyBox = findProductBuyBox();
  if (!buyBox) return false;

  const insertBefore = findInsertPoint(buyBox);
  if (insertBefore?.parentElement) {
    if (!isWrapperCorrectlyPlaced(wrapper, null)) {
      insertBefore.parentElement.insertBefore(wrapper, insertBefore);
      wrapper.dataset.protoRelocated = "true";
    }
    return true;
  }

  if (!buyBox.contains(wrapper)) {
    buyBox.prepend(wrapper);
    wrapper.dataset.protoRelocated = "true";
  }

  return true;
}

/** Move one wrapper using strategy 1 (stringing slot), falling back to strategy 2 (buy box). */
function moveWrapper(wrapper: HTMLElement) {
  if (relocateToStringingSlot(wrapper)) return;
  relocateToBuyBox(wrapper);
}

/**
 * Relocate every configurator wrapper on the page into the buy box, replacing the theme
 * stringing field where present. Idempotent — safe to call repeatedly.
 */
export function relocateConfiguratorToProductInfo() {
  document
    .querySelectorAll(".proto-configurator-button-wrapper")
    .forEach((node) => {
      if (node instanceof HTMLElement) moveWrapper(node);
    });
}

/**
 * Run relocation now and once more on the next animation frame. The second pass catches
 * themes that finish rendering the buy box slightly after our first attempt.
 *
 * NOTE: there is no MutationObserver, so later theme re-renders (e.g. on variant change) are
 * NOT re-handled — a known cause of the wrapper drifting out of place.
 */
export function scheduleConfiguratorRelocation() {
  relocateConfiguratorToProductInfo();
  requestAnimationFrame(() => {
    // A real re-scan, not the first pass's cache — the whole point of the second pass is to
    // catch themes that finish rendering after the first attempt.
    invalidateThemeBlockCache();
    relocateConfiguratorToProductInfo();
  });
}

/**
 * Compute where a newly-injected fallback wrapper should be inserted (used by
 * entry.tsx#injectProductPageButton when the theme block is absent).
 *
 * Prefers the theme stringing field's parent, then the buy box's insertion-point parent,
 * then the buy box itself.
 * @returns The container to insert into, or null if no suitable location exists.
 */
export function getProductInfoInsertPoint(): HTMLElement | null {
  const themeBlock = findThemeStringingBlock();
  if (themeBlock?.parentElement instanceof HTMLElement) {
    return themeBlock.parentElement;
  }

  const buyBox = findProductBuyBox();
  if (!buyBox) return null;

  const insertBefore = findInsertPoint(buyBox);
  if (insertBefore?.parentElement instanceof HTMLElement) {
    return insertBefore.parentElement;
  }

  return buyBox;
}
