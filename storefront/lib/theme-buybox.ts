type HiddenRecord = {
  el: HTMLElement;
  display: string;
};

let hiddenRecords: HiddenRecord[] = [];
let isBuyBoxHidden = false;

function isProtoElement(el: Element | null): boolean {
  if (!el) return false;
  if (el.closest(".proto-configurator-button-wrapper")) return true;
  if (el.closest(".proto-configurator-actions")) return true;
  if (el.querySelector?.(".proto-configurator-button-wrapper")) return true;
  return false;
}

function canHideElement(el: HTMLElement): boolean {
  if (isProtoElement(el)) return false;
  return !el.querySelector(".proto-configurator-button-wrapper");
}

function getProductForm(): Element | null {
  return (
    document.querySelector("product-form form") ??
    document.querySelector('form[action*="/cart/add"]')
  );
}

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

/** Hide Buy now / accelerated checkout when Strung is selected (quantity stays visible). */
export function setThemeBuyBoxHidden(hidden: boolean) {
  if (hidden === isBuyBoxHidden) return;
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
