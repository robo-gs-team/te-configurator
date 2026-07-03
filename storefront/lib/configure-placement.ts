/**
 * configure-placement.ts
 *
 * Handles swapping the Configure button INTO the theme's Add-to-Cart slot (and back) when
 * "Strung" is selected, and hiding/restoring the theme's native Add to Cart button.
 *
 * The goal is for the red "Configure" button to appear exactly where the theme's Add to Cart
 * normally sits, so a strung racquet routes through the configurator. To do that it:
 *   1. finds the theme Add to Cart button (best-effort, via a list of known selectors),
 *   2. hides it (`suppressAddToCartButtons`),
 *   3. moves the configurator's `actions` element into that slot, remembering where the
 *      actions came from (via `actionsAnchors`) so it can be put back when "Unstrung".
 *
 * NOTE (fragility): the original location is remembered in an in-memory WeakMap keyed by the
 * actions node. If the theme replaces that parent node on re-render, restoration can fail
 * and orphan the button. This is part of the known DOM-surgery fragility.
 */

/** Known theme selectors for the product's Add-to-Cart button, tried in order. */
const ADD_TO_CART_SELECTORS = [
  'button[name="add"]',
  ".product-form__submit",
  "[data-add-to-cart]",
  'button[type="submit"].button--add-to-cart',
  "#ProductSubmitButton",
  ".product-form__cart-submit",
  "button.add-to-cart",
];

/** Marker attribute set on theme buttons we've hidden, so we can find and restore them later. */
const SUPPRESSED_ATTR = "data-proto-atc-suppressed";

/** Remembers where an `actions` node lived before we relocated it, so we can move it back. */
type ActionsAnchor = {
  parent: HTMLElement;
  nextSibling: ChildNode | null;
};

/** Per-actions-node memory of its original DOM position (WeakMap so detached nodes are GC'd). */
const actionsAnchors = new WeakMap<HTMLElement, ActionsAnchor>();

/**
 * Find the `[data-proto-configurator-actions]` element (the box holding the Configure button)
 * for a given gate wrapper.
 *
 * Prefers a global lookup by shared `data-proto-stringing-gate-id` — necessary because the
 * actions node may have been MOVED out of the wrapper into the theme's buy box, so a plain
 * `wrapper.querySelector` would miss it. Falls back to searching within the wrapper.
 *
 * @param wrapper The gate wrapper element.
 * @returns The actions element, or null if not found.
 */
export function getConfiguratorActions(
  wrapper: HTMLElement,
): HTMLElement | null {
  const gateId = wrapper.dataset.protoStringingGateId;
  if (gateId) {
    const linked = document.querySelector<HTMLElement>(
      `[data-proto-configurator-actions][data-proto-stringing-gate-id="${gateId}"]`,
    );
    if (linked) return linked;
  }
  return wrapper.querySelector<HTMLElement>("[data-proto-configurator-actions]");
}

/**
 * Collect all theme Add-to-Cart buttons under `root`, de-duplicated, excluding any that live
 * inside the app's own button wrapper.
 * @param root Scope to search within (defaults to the whole document).
 * @returns Unique matching button elements.
 */
function queryAddToCartButtons(root: ParentNode = document): HTMLElement[] {
  const found = new Set<HTMLElement>();

  for (const selector of ADD_TO_CART_SELECTORS) {
    root.querySelectorAll(selector).forEach((node) => {
      if (!(node instanceof HTMLElement)) return;
      if (node.closest(".proto-configurator-button-wrapper")) return;
      found.add(node);
    });
  }

  return [...found];
}

/**
 * Find the single most relevant theme Add-to-Cart button, preferring one inside the product
 * form before falling back to a page-wide search.
 * @returns The Add to Cart button, or null if none found.
 */
export function findAddToCartButton(): HTMLElement | null {
  const form =
    document.querySelector("product-form form") ??
    document.querySelector('form[action*="/cart/add"]');

  if (form) {
    const inForm = queryAddToCartButtons(form);
    if (inForm.length > 0) return inForm[0];
  }

  const all = queryAddToCartButtons();
  return all[0] ?? null;
}

/**
 * Hide every theme Add-to-Cart button (idempotent). Each hidden button is tagged with
 * SUPPRESSED_ATTR and forced to `display:none !important` so it can be found and restored
 * later by `restoreAddToCartButtons`.
 */
function suppressAddToCartButtons() {
  for (const button of queryAddToCartButtons()) {
    if (button.getAttribute(SUPPRESSED_ATTR) === "true") continue;
    button.setAttribute(SUPPRESSED_ATTR, "true");
    button.hidden = true;
    button.setAttribute("aria-hidden", "true");
    button.style.setProperty("display", "none", "important");
  }
}

/**
 * Restore every theme Add-to-Cart button previously hidden by `suppressAddToCartButtons`,
 * clearing the inline display override and the SUPPRESSED_ATTR marker. Safe to call anytime.
 */
export function restoreAddToCartButtons() {
  document.querySelectorAll<HTMLElement>(`[${SUPPRESSED_ATTR}="true"]`).forEach(
    (button) => {
      button.hidden = false;
      button.removeAttribute("aria-hidden");
      button.style.removeProperty("display");
      button.removeAttribute(SUPPRESSED_ATTR);
    },
  );
}

/**
 * Move the Configure button into the theme's Add-to-Cart slot (Strung) or back to its
 * original position (Unstrung).
 *
 * When `showConfigure` is true: records the actions node's original position (once), hides
 * the theme Add to Cart, makes the actions visible + full-width (`--inline`), and inserts it
 * right after the (now hidden) Add to Cart button so Configure sits exactly where Add to Cart
 * was. When false: removes the inline styling, hides the actions, moves it back to its
 * remembered anchor, and restores the theme Add to Cart.
 *
 * @param wrapper The gate wrapper whose actions should be relocated.
 * @param showConfigure true for Strung (show Configure in the buy box), false for Unstrung.
 */
export function syncConfigureButtonSlot(
  wrapper: HTMLElement,
  showConfigure: boolean,
) {
  const actions = getConfiguratorActions(wrapper);
  if (!actions) return;

  if (showConfigure) {
    const addToCart = findAddToCartButton();
    const slot = addToCart?.parentElement;

    if (!slot) return;

    if (!actionsAnchors.has(actions)) {
      actionsAnchors.set(actions, {
        parent: actions.parentElement ?? wrapper,
        nextSibling: actions.nextSibling,
      });
    }

    suppressAddToCartButtons();

    actions.hidden = false;
    actions.setAttribute("aria-hidden", "false");
    actions.classList.add("proto-configurator-actions--inline");

    if (actions.parentElement !== slot) {
      slot.insertBefore(actions, addToCart?.nextSibling ?? null);
    }
    return;
  }

  actions.classList.remove("proto-configurator-actions--inline");
  actions.hidden = true;
  actions.setAttribute("aria-hidden", "true");

  const anchor = actionsAnchors.get(actions);
  if (anchor && actions.parentElement !== anchor.parent) {
    anchor.parent.insertBefore(actions, anchor.nextSibling);
  }

  restoreAddToCartButtons();
}
