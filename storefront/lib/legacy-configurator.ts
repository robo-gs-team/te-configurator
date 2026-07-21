/**
 * legacy-configurator.ts
 *
 * Hides the merchant's previous hand-built Liquid stringing configurator (a `<product-configurator>`
 * custom element wrapped in `.product-configurator`, confirmed present on the racquet PDP template)
 * whenever THIS app's configurator is active for the current product — so a shopper never sees two
 * competing stringing UIs on the same page. Only ever called from product-linkage.ts's
 * markProductLinked/markProductUnlinked, so it only touches racquets this app is actually assigned
 * to; every other product page (including racquets not yet assigned) is completely untouched.
 *
 * Same "record original inline display, hide with !important, restore exactly" approach as
 * theme-buybox.ts, for the same reason: non-destructive and safely reversible if the app is ever
 * disabled or the assignment changes.
 */

type HiddenRecord = {
  el: HTMLElement;
  display: string;
};

let hiddenRecords: HiddenRecord[] = [];
let isHidden = false;

const LEGACY_SELECTOR = "product-configurator, .product-configurator";

/**
 * Hide or restore the legacy Liquid configurator on the current page.
 * @param hidden true to hide it (this app's configurator is taking over this product),
 *   false to restore it to its original state (this app is not — or no longer — active here).
 */
export function setLegacyConfiguratorHidden(hidden: boolean) {
  if (hidden === isHidden) return;
  isHidden = hidden;

  if (hidden) {
    hiddenRecords = Array.from(document.querySelectorAll<HTMLElement>(LEGACY_SELECTOR)).map(
      (el) => {
        const display = el.style.display;
        el.style.setProperty("display", "none", "important");
        el.setAttribute("aria-hidden", "true");
        el.dataset.protoLegacyHidden = "true";
        return { el, display };
      },
    );
    return;
  }

  hiddenRecords.forEach(({ el, display }) => {
    if (display) {
      el.style.display = display;
    } else {
      el.style.removeProperty("display");
    }
    el.removeAttribute("aria-hidden");
    delete el.dataset.protoLegacyHidden;
  });
  hiddenRecords = [];
}
