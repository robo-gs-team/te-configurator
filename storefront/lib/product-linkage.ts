import { normalizeProductId } from "./product-id";
import { restoreAddToCartButtons } from "./configure-placement";
import { setThemeBuyBoxHidden } from "./theme-buybox";

export function getPageProductId(): string | null {
  const fromSettings = window.ProtoConfiguratorSettings?.productId;
  if (fromSettings) return normalizeProductId(fromSettings);

  const fromDom = document.querySelector<HTMLElement>("[data-product-id]")?.dataset.productId;
  if (fromDom) return normalizeProductId(fromDom);

  const fromTrigger = document.querySelector<HTMLElement>(
    "[data-proto-configurator-trigger]",
  )?.dataset.productId;
  if (fromTrigger) return normalizeProductId(fromTrigger);

  return null;
}

export function markProductLinkagePending() {
  document.documentElement.classList.add("proto-configurator-pending");
  document.documentElement.classList.remove(
    "proto-configurator-linked",
    "proto-configurator-unlinked",
  );
}

export function markProductLinked() {
  document.documentElement.classList.remove(
    "proto-configurator-pending",
    "proto-configurator-unlinked",
  );
  document.documentElement.classList.add("proto-configurator-linked");
}

export function markProductUnlinked() {
  document.documentElement.classList.remove(
    "proto-configurator-pending",
    "proto-configurator-linked",
  );
  document.documentElement.classList.add("proto-configurator-unlinked");
  setThemeBuyBoxHidden(false);
  restoreAddToCartButtons();
}
