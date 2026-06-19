const ADD_TO_CART_SELECTORS = [
  'button[name="add"]',
  ".product-form__submit",
  "[data-add-to-cart]",
  'button[type="submit"].button--add-to-cart',
  "#ProductSubmitButton",
  ".product-form__cart-submit",
  "button.add-to-cart",
];

const SUPPRESSED_ATTR = "data-proto-atc-suppressed";

type ActionsAnchor = {
  parent: HTMLElement;
  nextSibling: ChildNode | null;
};

const actionsAnchors = new WeakMap<HTMLElement, ActionsAnchor>();

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

function suppressAddToCartButtons() {
  for (const button of queryAddToCartButtons()) {
    if (button.getAttribute(SUPPRESSED_ATTR) === "true") continue;
    button.setAttribute(SUPPRESSED_ATTR, "true");
    button.hidden = true;
    button.setAttribute("aria-hidden", "true");
    button.style.setProperty("display", "none", "important");
  }
}

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

/** Move Configure into the theme Add to cart slot when Strung is selected. */
export function syncConfigureButtonSlot(
  wrapper: HTMLElement,
  showConfigure: boolean,
) {
  const actions = wrapper.querySelector<HTMLElement>(
    "[data-proto-configurator-actions]",
  );
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
