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
  'button[name="configure"]',
  ".product-form__submit",
  "[data-add-to-cart]",
  'button[type="submit"].button--add-to-cart',
  "#ProductSubmitButton",
  "#AddToCart",
  "#ProductPopup-Configurator",
  "#ProductPopup-Configurator-Hybrid",
  ".product-form__cart-submit",
  "button.add-to-cart",
  ".single-add-to-cart-button",
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
      if (node.closest(".proto-v2-standalone-wrapper")) return;
      if (node.hasAttribute("data-proto-configurator-trigger")) return;
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
 * IMPORTANT: never insert inside `.product-buy-buttons` — the theme's product-configurator.js
 * replaces that node's innerHTML on every Strung/Unstrung change and would destroy our button.
 * Place as a sibling after that container (same strategy as syncStandaloneConfigureSlot).
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
    const target = findStandaloneSlotTarget();
    if (!target) {
      // Fall back to parking beside the ATC button when the theme markup is unfamiliar.
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

    if (!actionsAnchors.has(actions)) {
      actionsAnchors.set(actions, {
        parent: actions.parentElement ?? wrapper,
        nextSibling: actions.nextSibling,
      });
    }

    // Pull out of a wiped container if a prior pass parked us inside it.
    if (actions.closest(".product-buy-buttons")) {
      const anchor = actionsAnchors.get(actions);
      if (anchor) {
        anchor.parent.insertBefore(actions, anchor.nextSibling);
      }
    }

    document.documentElement.toggleAttribute("data-proto-v2-atc-slot", true);
    suppressThemeConfigureUi(target.hideRoots);

    actions.hidden = false;
    actions.setAttribute("aria-hidden", "false");
    actions.classList.add("proto-configurator-actions--inline");

    if (
      actions.parentElement !== target.insertParent ||
      actions.nextSibling !== target.beforeNode
    ) {
      target.insertParent.insertBefore(actions, target.beforeNode);
    }
    return;
  }

  document.documentElement.removeAttribute("data-proto-v2-atc-slot");
  actions.classList.remove("proto-configurator-actions--inline");
  actions.hidden = true;
  actions.setAttribute("aria-hidden", "true");

  const anchor = actionsAnchors.get(actions);
  if (anchor && actions.parentElement !== anchor.parent) {
    anchor.parent.insertBefore(actions, anchor.nextSibling);
  }

  restoreThemeBuyButtonsRegion();
  restoreAddToCartButtons();
}

/** Marker for theme buy-button regions we hide while the gear CTA is slotted. */
const BUY_BUTTONS_SUPPRESSED_ATTR = "data-proto-buy-buttons-suppressed";
/** Legacy theme Configure popup triggers — kept suppressed even when ATC is restored. */
const LEGACY_CONFIGURE_SUPPRESSED_ATTR = "data-proto-legacy-configure-suppressed";

/** Theme selectors for the legacy product-configurator "Configure" button (not our app). */
const THEME_CONFIGURE_SELECTORS = [
  'button[name="configure"]',
  "#ProductPopup-Configurator",
  "#ProductPopup-Configurator-Hybrid",
  ".product-popup-modal__opener[data-modal*='Configurator']",
  '.add_to_cart_holder.product-popup-modal__opener',
];

/**
 * Tennis Express buy row is a CSS grid (`quantity` | `buy-buttons`, sometimes with a
 * `configurator` row above). Theme `product-configurator.js` wipes `.product-buy-buttons`
 * innerHTML on Strung/Unstrung, so we never mount inside that node.
 *
 * Do NOT use `grid-area: configurator` — on TE that row is shared with "Choose Your Stringing"
 * and stacking there overlaps the dropdown (see live PDP).
 */
function findStandaloneSlotTarget(): {
  insertParent: HTMLElement;
  beforeNode: ChildNode | null;
  hideRoots: HTMLElement[];
  /** The whole buy grid — used to park Configure above it when Unstrung. */
  buyGrid: HTMLElement;
} | null {
  const buyButtons = document.querySelector<HTMLElement>(".product-buy-buttons");
  const grid =
    buyButtons?.closest<HTMLElement>(
      ".product-quantity-buy-buttons, .product-configurator-quantity-buy-buttons",
    ) ?? buyButtons?.parentElement;

  if (grid && buyButtons) {
    return {
      insertParent: grid,
      beforeNode: buyButtons.nextSibling,
      hideRoots: [buyButtons],
      buyGrid: grid,
    };
  }

  if (grid) {
    return {
      insertParent: grid,
      beforeNode: grid.firstChild,
      hideRoots: [],
      buyGrid: grid,
    };
  }

  const addToCart = findAddToCartButton();
  const holder =
    addToCart?.closest<HTMLElement>(".add_to_cart_holder") ??
    addToCart?.parentElement;
  if (holder?.parentElement) {
    return {
      insertParent: holder.parentElement,
      beforeNode: holder.nextSibling,
      hideRoots: [holder],
      buyGrid: holder.parentElement,
    };
  }

  return null;
}

/** Hide the theme's legacy Configure popup triggers without touching Add to cart. */
function suppressLegacyConfigureOnly() {
  for (const selector of THEME_CONFIGURE_SELECTORS) {
    document.querySelectorAll(selector).forEach((node) => {
      if (!(node instanceof HTMLElement)) return;
      if (node.closest(".proto-v2-standalone-wrapper")) return;
      if (node.getAttribute(LEGACY_CONFIGURE_SUPPRESSED_ATTR) === "true") return;
      node.setAttribute(LEGACY_CONFIGURE_SUPPRESSED_ATTR, "true");
      node.hidden = true;
      node.setAttribute("aria-hidden", "true");
      node.style.setProperty("display", "none", "important");
    });
  }
}

function suppressThemeConfigureUi(hideRoots: HTMLElement[]) {
  for (const root of hideRoots) {
    root.setAttribute(BUY_BUTTONS_SUPPRESSED_ATTR, "true");
    root.setAttribute("aria-hidden", "true");
    // Keep the node in the CSS grid (do NOT display:none). Freeing the buy-buttons cell lets
    // auto-placed siblings (inventory notice, etc.) occupy it and steal Configure clicks.
    root.style.removeProperty("display");
    root.style.setProperty("visibility", "hidden", "important");
    root.style.setProperty("pointer-events", "none", "important");
  }

  suppressLegacyConfigureOnly();
  suppressAddToCartButtons();
}

function restoreThemeBuyButtonsRegion() {
  document
    .querySelectorAll<HTMLElement>(`[${BUY_BUTTONS_SUPPRESSED_ATTR}="true"]`)
    .forEach((el) => {
      el.removeAttribute(BUY_BUTTONS_SUPPRESSED_ATTR);
      el.removeAttribute("aria-hidden");
      el.style.removeProperty("display");
      el.style.removeProperty("visibility");
      el.style.removeProperty("pointer-events");
    });
}

/**
 * Place the v2 gear Configure button for the current Strung/Unstrung choice.
 *
 * - Strung: sit in the `buy-buttons` grid cell (beside quantity), hide theme ATC/legacy Configure.
 * - Unstrung: park above the buy grid and hide Configure (`proto-v2-hide-unstrung`); ATC returns.
 *
 * IMPORTANT: never insert inside `.product-buy-buttons` — the theme replaces that node's
 * innerHTML on every Strung/Unstrung change and would destroy our button.
 */
export function syncStandaloneConfigureSlot(replaceAddToCart: boolean) {
  // While a Configure open is in flight, do not relocate/hide the button — mid-open DOM surgery
  // was a common cause of "I tapped Configure and nothing happened" (trigger detached, feedback
  // host lost, or visibility check racing the MutationObserver).
  if (document.documentElement.hasAttribute("data-proto-configuring")) return;

  const standalone = document.querySelector<HTMLElement>(
    ".proto-v2-standalone-wrapper",
  );
  if (!standalone || !standalone.isConnected) return;

  document.documentElement.toggleAttribute("data-proto-v2-atc-slot", replaceAddToCart);

  if (!actionsAnchors.has(standalone)) {
    actionsAnchors.set(standalone, {
      parent: standalone.parentElement ?? document.body,
      nextSibling: standalone.nextSibling,
    });
  }

  // If we previously parked inside a wiped container, pull back to the saved anchor first.
  if (standalone.closest(".product-buy-buttons")) {
    const anchor = actionsAnchors.get(standalone);
    if (anchor) {
      anchor.parent.insertBefore(standalone, anchor.nextSibling);
    }
  }

  const target = findStandaloneSlotTarget();
  standalone.hidden = false;
  standalone.style.removeProperty("display");
  // Inline visibility must clear so CSS (linked / hide-unstrung / inline-slot) can win.
  standalone.style.removeProperty("visibility");

  if (!target) {
    suppressLegacyConfigureOnly();
    standalone.classList.remove("proto-v2-inline-slot");
    standalone.style.removeProperty("grid-area");
    delete standalone.dataset.protoGridArea;
    return;
  }

  if (replaceAddToCart) {
    // Strung → own the ATC cell beside quantity.
    standalone.classList.remove("proto-v2-hide-unstrung");
    standalone.classList.add("proto-v2-inline-slot");
    standalone.dataset.protoGridArea = "buy-buttons";
    standalone.style.gridArea = "buy-buttons";

    if (
      standalone.parentElement !== target.insertParent ||
      standalone.nextSibling !== target.beforeNode
    ) {
      target.insertParent.insertBefore(standalone, target.beforeNode);
    }
    suppressThemeConfigureUi(target.hideRoots);
    return;
  }

  // Unstrung → park above the buy grid, restore ATC, hide Configure (nothing to configure).
  restoreThemeBuyButtonsRegion();
  restoreAddToCartButtons();
  suppressLegacyConfigureOnly();

  standalone.classList.remove("proto-v2-inline-slot");
  standalone.classList.add("proto-v2-hide-unstrung");
  standalone.style.removeProperty("grid-area");
  delete standalone.dataset.protoGridArea;

  const grid = target.buyGrid;
  const host = grid.parentElement;
  if (host && (standalone.parentElement !== host || standalone.nextSibling !== grid)) {
    host.insertBefore(standalone, grid);
  }
}
