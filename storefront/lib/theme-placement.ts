const STRINGING_LABEL = "choose your stringing";

const PRODUCT_BUY_BOX_SELECTORS = [
  "product-form",
  'form[action*="/cart/add"]',
  ".product-form",
  ".product-info__buy-box",
  ".product__buy-buttons",
  "[data-product-form]",
  ".product-form__buttons",
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
];

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

function findProductFormAnchor(): Element | null {
  return (
    document.querySelector("product-form") ??
    document.querySelector('form[action*="/cart/add"]') ??
    document.querySelector(".product-form") ??
    document.querySelector("[data-product-form]")
  );
}

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

function normalizeLabelText(el: Element): string {
  return el.textContent?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";
}

function isStringingLabel(el: Element): boolean {
  const text = normalizeLabelText(el);
  return text === STRINGING_LABEL || text.includes(STRINGING_LABEL);
}

/** Theme "Choose Your Stringing" block (Vision and similar themes). */
export function findThemeStringingBlock(): HTMLElement | null {
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

function hideThemeElement(el: HTMLElement) {
  el.style.display = "none";
  el.setAttribute("aria-hidden", "true");
  el.dataset.protoThemeStringingHidden = "true";
}

function findInsertPoint(container: HTMLElement): Element | null {
  for (const selector of INSERT_BEFORE_SELECTORS) {
    const el = container.querySelector(selector);
    if (el && !el.closest(".proto-configurator-button-wrapper")) return el;
  }
  return null;
}

function isBeforeInDom(earlier: Element, later: Element): boolean {
  return Boolean(earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING);
}

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

function moveWrapper(wrapper: HTMLElement) {
  if (relocateToStringingSlot(wrapper)) return;
  relocateToBuyBox(wrapper);
}

/** Move configurator UI into the buy box, replacing the theme stringing field. */
export function relocateConfiguratorToProductInfo() {
  document
    .querySelectorAll(".proto-configurator-button-wrapper")
    .forEach((node) => {
      if (node instanceof HTMLElement) moveWrapper(node);
    });
}

export function scheduleConfiguratorRelocation() {
  relocateConfiguratorToProductInfo();
  requestAnimationFrame(() => relocateConfiguratorToProductInfo());
}

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
