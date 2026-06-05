type HiddenRecord = {
  el: HTMLElement;
  display: string;
};

let hiddenRecords: HiddenRecord[] = [];
let isBuyBoxHidden = false;

function isProtoElement(el: Element | null): boolean {
  if (!el) return false;
  if (el.closest(".proto-configurator-button-wrapper")) return true;
  if (el.querySelector?.(".proto-configurator-button-wrapper")) return true;
  return false;
}

function canHideElement(el: HTMLElement): boolean {
  if (isProtoElement(el)) return false;
  return !el.querySelector(".proto-configurator-button-wrapper");
}

function getProductForm(): Element | null {
  return (
    document.querySelector('product-form form') ??
    document.querySelector('form[action*="/cart/add"]')
  );
}

function getThemeQuantityInput(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>(
    'form[action*="/cart/add"] input[name="quantity"], product-form input[name="quantity"]',
  );
}

function findThemeBuyBoxElements(): HTMLElement[] {
  const form = getProductForm();
  const found: HTMLElement[] = [];

  const qtyInput = getThemeQuantityInput();
  if (qtyInput) {
    const qtyContainer =
      qtyInput.closest("quantity-input") ??
      qtyInput.closest(".quantity-selector") ??
      qtyInput.closest(".product-form__quantity") ??
      qtyInput.parentElement;

    if (qtyContainer instanceof HTMLElement && canHideElement(qtyContainer)) {
      found.push(qtyContainer);
    }
  }

  const addToCartSelectors = [
    'button[name="add"]',
    ".product-form__submit",
    "[data-add-to-cart]",
    'button[type="submit"].button--add-to-cart',
    "#ProductSubmitButton",
  ];

  if (form) {
    for (const selector of addToCartSelectors) {
      const button = form.querySelector(selector);
      if (button instanceof HTMLElement && canHideElement(button)) {
        found.push(button);
        break;
      }
    }
  }

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

  return [...new Set(found)];
}

export function setThemeBuyBoxHidden(hidden: boolean) {
  if (hidden === isBuyBoxHidden) return;
  isBuyBoxHidden = hidden;

  if (hidden) {
    hiddenRecords = findThemeBuyBoxElements().map((el) => {
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
