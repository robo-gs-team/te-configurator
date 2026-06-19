const ADD_TO_CART_SELECTORS = [
  'button[name="add"]',
  ".product-form__submit",
  "[data-add-to-cart]",
  'button[type="submit"].button--add-to-cart',
  "#ProductSubmitButton",
];

type ActionsAnchor = {
  parent: HTMLElement;
  nextSibling: ChildNode | null;
};

const actionsAnchors = new WeakMap<HTMLElement, ActionsAnchor>();
const hiddenAddToCart = new WeakMap<HTMLElement, { display: string }>();

export function findAddToCartButton(): HTMLElement | null {
  const form =
    document.querySelector("product-form form") ??
    document.querySelector('form[action*="/cart/add"]');

  for (const selector of ADD_TO_CART_SELECTORS) {
    const button = form?.querySelector(selector);
    if (button instanceof HTMLElement) return button;
  }

  for (const selector of ADD_TO_CART_SELECTORS) {
    const button = document.querySelector(selector);
    if (button instanceof HTMLElement) return button;
  }

  return null;
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

  const addToCart = findAddToCartButton();

  if (showConfigure && addToCart?.parentElement) {
    const slot = addToCart.parentElement;

    if (!actionsAnchors.has(actions)) {
      actionsAnchors.set(actions, {
        parent: actions.parentElement ?? wrapper,
        nextSibling: actions.nextSibling,
      });
    }

    if (!hiddenAddToCart.has(addToCart)) {
      hiddenAddToCart.set(addToCart, { display: addToCart.style.display });
    }

    addToCart.hidden = true;
    addToCart.setAttribute("aria-hidden", "true");
    addToCart.style.setProperty("display", "none", "important");

    actions.hidden = false;
    actions.setAttribute("aria-hidden", "false");
    actions.classList.add("proto-configurator-actions--inline");

    if (actions.parentElement !== slot) {
      slot.insertBefore(actions, addToCart.nextSibling);
    }
    return;
  }

  actions.classList.remove("proto-configurator-actions--inline");
  actions.hidden = !showConfigure;
  actions.setAttribute("aria-hidden", showConfigure ? "false" : "true");

  const anchor = actionsAnchors.get(actions);
  if (anchor && actions.parentElement !== anchor.parent) {
    anchor.parent.insertBefore(actions, anchor.nextSibling);
  }

  if (addToCart) {
    const prev = hiddenAddToCart.get(addToCart);
    addToCart.hidden = false;
    addToCart.removeAttribute("aria-hidden");
    if (prev?.display) {
      addToCart.style.display = prev.display;
    } else {
      addToCart.style.removeProperty("display");
    }
    hiddenAddToCart.delete(addToCart);
  }
}
