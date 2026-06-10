const PRODUCT_INFO_SELECTORS = [
  "#ProductInfo",
  ".product__info",
  ".product-info",
  ".product-single__meta",
  ".product-main-info",
  "[data-product-info]",
  ".product__info-wrapper",
  ".product-details",
  ".product-detail",
];

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
  'form[action*="/cart/add"]',
  "product-form",
];

function findProductFormAnchor(): Element | null {
  return (
    document.querySelector("product-form") ??
    document.querySelector('form[action*="/cart/add"]') ??
    document.querySelector(".product-form") ??
    document.querySelector("[data-product-form]")
  );
}

export function findProductInfoContainer(): HTMLElement | null {
  for (const selector of PRODUCT_INFO_SELECTORS) {
    const el = document.querySelector(selector);
    if (el instanceof HTMLElement) return el;
  }

  const form = findProductFormAnchor();
  if (form) {
    const info = form.closest(
      ".product__info, .product-info, #ProductInfo, .product-single__meta, .product-details",
    );
    if (info instanceof HTMLElement) return info;
  }

  const mainProduct = document.querySelector(
    'main [class*="product"], section[class*="product"]',
  );
  if (mainProduct instanceof HTMLElement) {
    const formInMain = mainProduct.querySelector(
      'form[action*="/cart/add"], product-form, .product-form',
    );
    if (formInMain) {
      const info = formInMain.closest(
        ".product__info, .product-info, #ProductInfo, .product-single__meta",
      );
      if (info instanceof HTMLElement) return info;
      return mainProduct;
    }
  }

  return null;
}

function findInsertPoint(container: HTMLElement): Element | null {
  for (const selector of INSERT_BEFORE_SELECTORS) {
    const el = container.querySelector(selector);
    if (el && !el.closest(".proto-configurator-button-wrapper")) return el;
  }
  return null;
}

function hideDuplicateThemeStringing(
  productInfo: HTMLElement,
  configuratorWrapper: HTMLElement,
) {
  const hasAppDropdown = configuratorWrapper.querySelector(
    "[data-proto-stringing-select]",
  );
  if (!hasAppDropdown) return;

  const labels = productInfo.querySelectorAll("label, .form__label, legend, p, span");
  labels.forEach((label) => {
    if (!(label instanceof HTMLElement)) return;
    if (configuratorWrapper.contains(label)) return;

    const text = label.textContent?.trim().toLowerCase() ?? "";
    if (!text.includes("choose your stringing")) return;

    const field =
      label.closest(
        ".product-form__input, .form-group, fieldset, .select-wrapper, .variant-wrapper, .product-form__item, .field",
      ) ?? label.parentElement;

    if (!field || configuratorWrapper.contains(field)) return;
    if (field instanceof HTMLElement && field.dataset.protoThemeStringingHidden) return;

    if (field instanceof HTMLElement) {
      field.style.display = "none";
      field.setAttribute("aria-hidden", "true");
      field.dataset.protoThemeStringingHidden = "true";
    }
  });
}

function moveWrapperIntoProductInfo(
  wrapper: HTMLElement,
  productInfo: HTMLElement,
) {
  if (productInfo.contains(wrapper)) {
    hideDuplicateThemeStringing(productInfo, wrapper);
    return;
  }

  const insertBefore = findInsertPoint(productInfo);
  if (insertBefore?.parentElement) {
    insertBefore.parentElement.insertBefore(wrapper, insertBefore);
  } else {
    productInfo.appendChild(wrapper);
  }

  wrapper.dataset.protoRelocated = "true";
  hideDuplicateThemeStringing(productInfo, wrapper);
}

/** Move configurator UI from page-level app blocks into the product info column. */
export function relocateConfiguratorToProductInfo() {
  const productInfo = findProductInfoContainer();
  if (!productInfo) return;

  document
    .querySelectorAll(".proto-configurator-button-wrapper")
    .forEach((node) => {
      if (node instanceof HTMLElement) {
        moveWrapperIntoProductInfo(node, productInfo);
      }
    });
}

export function scheduleConfiguratorRelocation() {
  relocateConfiguratorToProductInfo();
  requestAnimationFrame(() => relocateConfiguratorToProductInfo());
}

export function getProductInfoInsertPoint(): HTMLElement | null {
  const productInfo = findProductInfoContainer();
  if (!productInfo) return null;

  const insertBefore = findInsertPoint(productInfo);
  if (insertBefore?.parentElement instanceof HTMLElement) {
    return insertBefore.parentElement;
  }

  return productInfo;
}
