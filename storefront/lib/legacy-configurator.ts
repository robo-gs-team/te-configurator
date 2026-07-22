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
 *
 * SELF-HEALING: the legacy widget has its OWN logic that reveals itself when "Strung" is
 * selected (its original designed behaviour, predating this app), and does so by setting its
 * own inline `style.display` directly — which REPLACES our `!important`-flagged value rather
 * than merely fighting it. Re-hiding only in response to a `change` event lost this race
 * whenever the widget's own reveal ran asynchronously (a framework reactivity tick, a timeout,
 * etc.) after our re-hide already fired. A MutationObserver watching the hidden element(s)
 * catches the ACTUAL DOM mutation the instant it happens, regardless of what triggered it or
 * how it's timed, and immediately clobbers it back — so the widget can never win.
 */

type HiddenRecord = {
  el: HTMLElement;
  display: string;
};

let hiddenRecords: HiddenRecord[] = [];
let isHidden = false;
let observer: MutationObserver | null = null;

const LEGACY_SELECTOR = "product-configurator, .product-configurator";

/** Force `el` fully hidden, recording its pre-hide inline display exactly once. */
function forceHide(el: HTMLElement) {
  if (!hiddenRecords.some((r) => r.el === el)) {
    hiddenRecords.push({ el, display: el.style.display });
  }
  if (el.style.display === "none") return;
  el.style.setProperty("display", "none", "important");
  el.setAttribute("aria-hidden", "true");
  el.dataset.protoLegacyHidden = "true";
}

/** Re-hide every currently-matching legacy element that isn't already hidden. */
function reapplyHideToAllMatches() {
  document.querySelectorAll<HTMLElement>(LEGACY_SELECTOR).forEach(forceHide);
}

/** Start watching for the legacy widget re-showing itself (attribute change or re-render). */
function startObserving() {
  if (observer) return;
  observer = new MutationObserver(() => {
    if (isHidden) reapplyHideToAllMatches();
  });
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ["style", "class", "hidden"],
    childList: true,
    subtree: true,
  });
}

function stopObserving() {
  observer?.disconnect();
  observer = null;
}

/**
 * Hide or restore the legacy Liquid configurator on the current page.
 * @param hidden true to hide it (this app's configurator is taking over this product),
 *   false to restore it to its original state (this app is not — or no longer — active here).
 */
export function setLegacyConfiguratorHidden(hidden: boolean) {
  if (hidden === isHidden) return;
  isHidden = hidden;

  if (hidden) {
    hiddenRecords = [];
    reapplyHideToAllMatches();
    startObserving();
    return;
  }

  stopObserving();
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
