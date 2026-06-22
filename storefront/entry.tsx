import { createRoot, type Root } from "react-dom/client";
import { ConfiguratorErrorBoundary } from "./components/ConfiguratorErrorBoundary";
import { ConfiguratorModal } from "./components/ConfiguratorModal";
import { useConfiguratorStore } from "./store/configurator-store";
import { clearConfigureError, showConfigureError } from "./lib/configure-feedback";
import { collectImageUrls, preloadImages } from "./lib/image-preloader";
import { normalizeProductId } from "./lib/product-id";
import { refreshThemeBuyBoxHidden, setThemeBuyBoxHidden } from "./lib/theme-buybox";
import { syncConfigureButtonSlot, restoreAddToCartButtons } from "./lib/configure-placement";
import { createStringingGateWrapper } from "./lib/stringing-gate";
import {
  getPageProductId,
  markProductLinked,
  markProductLinkagePending,
  markProductUnlinked,
} from "./lib/product-linkage";
import {
  findThemeStringingBlock,
  getProductInfoInsertPoint,
  scheduleConfiguratorRelocation,
} from "./lib/theme-placement";
import type { StorefrontConfigurator } from "~/lib/configurator.types";
import { getDefaultSelections } from "~/lib/conditional-logic";
import "./styles.css";

declare global {
  interface Window {
    ProtoConfigurator?: {
      open: (productId: string, configurator: StorefrontConfigurator) => void;
      close: () => void;
    };
    ProtoConfiguratorSettings?: {
      appProxyUrl: string;
      productId: string;
      shopDomain?: string;
    };
    Shopify?: {
      shop?: string;
    };
  }
}

let reactRoot: Root | null = null;

function App() {
  return (
    <ConfiguratorErrorBoundary>
      <ConfiguratorModal />
    </ConfiguratorErrorBoundary>
  );
}

function mount() {
  let rootEl = document.getElementById("proto-configurator-root");
  if (!rootEl) {
    rootEl = document.createElement("div");
    rootEl.id = "proto-configurator-root";
    rootEl.className = "proto-configurator-root";
    rootEl.style.cssText = "position:relative;z-index:2147483646;";
    document.body.appendChild(rootEl);
  }

  if (!reactRoot) {
    reactRoot = createRoot(rootEl);
  }
  reactRoot.render(<App />);
}

function getShopDomain(): string {
  return (
    window.ProtoConfiguratorSettings?.shopDomain ??
    window.Shopify?.shop ??
    ""
  );
}

function getProxyUrl(): string {
  return window.ProtoConfiguratorSettings?.appProxyUrl ?? "/apps/proto-configurator";
}

async function fetchConfigurator(
  productId: string,
): Promise<{ configurator: StorefrontConfigurator | null; error?: string }> {
  const proxyUrl = getProxyUrl();
  const normalizedId = normalizeProductId(productId);
  const shop = getShopDomain();

  const query = new URLSearchParams();
  if (shop) query.set("shop", shop);

  const queryString = query.toString();
  const url = `${proxyUrl}/product/${normalizedId}${queryString ? `?${queryString}` : ""}`;

  try {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);

    const res = await fetch(url, {
      credentials: "same-origin",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    window.clearTimeout(timeout);

    const contentType = res.headers.get("content-type") ?? "";
    const raw = await res.text();

    if (!contentType.includes("application/json")) {
      return {
        configurator: null,
        error:
          "Configurator API did not respond. Keep npm run dev running, then refresh this page.",
      };
    }

    const data = JSON.parse(raw) as {
      configurator?: StorefrontConfigurator | null;
      error?: string;
      code?: string;
      productId?: string;
    };

    if (!res.ok) {
      return {
        configurator: null,
        error: data.error ?? `Configurator request failed (${res.status})`,
      };
    }

    if (data.configurator) {
      return { configurator: data.configurator };
    }

    if (data.error) {
      return { configurator: null, error: data.error };
    }

    return {
      configurator: null,
      error:
        "No configurator linked to this product. Select products in the app admin, enable Active, and click Save changes.",
    };
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === "AbortError";
    return {
      configurator: null,
      error: aborted
        ? "Configurator request timed out. Check that npm run dev is running."
        : "Could not reach the configurator. Keep npm run dev running, then refresh this page.",
    };
  }
}

function setTriggerLoading(trigger: HTMLElement, loading: boolean) {
  trigger.toggleAttribute("disabled", loading);
  trigger.setAttribute("aria-busy", loading ? "true" : "false");
  trigger.style.opacity = loading ? "0.75" : "";
  trigger.style.cursor = loading ? "wait" : "pointer";
}

async function openConfigurator(productId: string, trigger: HTMLElement) {
  clearConfigureError(trigger);
  setTriggerLoading(trigger, true);

  try {
    const { configurator, error } = await fetchConfigurator(productId);
    if (error) {
      showConfigureError(trigger, error);
      return;
    }

    if (!configurator) {
      showConfigureError(
        trigger,
        "No configurator is linked to this product. Select products in the app admin, enable Active, and click Save changes.",
      );
      return;
    }

    useConfiguratorStore.getState().open(productId, configurator);
    void preloadImages(collectImageUrls(configurator)).catch(() => {});
  } catch (err) {
    showConfigureError(
      trigger,
      err instanceof Error ? err.message : "Failed to open configurator.",
    );
  } finally {
    setTriggerLoading(trigger, false);
  }
}

function isConfigureTriggerVisible(trigger: HTMLElement): boolean {
  const actions = trigger.closest("[data-proto-configurator-actions]");
  if (actions?.hasAttribute("hidden")) return false;
  if (trigger.hasAttribute("hidden")) return false;
  const style = window.getComputedStyle(trigger);
  return style.display !== "none" && style.visibility !== "hidden" && style.pointerEvents !== "none";
}

function handleConfigureClick(trigger: HTMLElement, event: Event) {
  if (!isConfigureTriggerVisible(trigger)) return;

  event.preventDefault();
  event.stopPropagation();

  const productId =
    trigger.dataset.productId ??
    window.ProtoConfiguratorSettings?.productId ??
    "";

  if (!productId) {
    showConfigureError(trigger, "Product ID is missing on this page.");
    return;
  }

  void openConfigurator(productId, trigger);
}

function initConfigureClickDelegation() {
  if (document.documentElement.dataset.protoClickDelegated) return;
  document.documentElement.dataset.protoClickDelegated = "true";

  document.addEventListener(
    "click",
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const trigger = target.closest<HTMLElement>("[data-proto-configurator-trigger]");
      if (!trigger) return;

      handleConfigureClick(trigger, event);
    },
    true,
  );
}

function shouldHideThemeBuyBox(wrapper: HTMLElement): boolean {
  return wrapper.dataset.hideThemeBuybox !== "false";
}

function updateStringingGate(wrapper: HTMLElement) {
  const select = wrapper.querySelector<HTMLSelectElement>(
    "[data-proto-stringing-select]",
  );
  const actions = wrapper.querySelector<HTMLElement>(
    "[data-proto-configurator-actions]",
  );
  if (!select || !actions) return;

  const trigger = wrapper.dataset.triggerValue ?? "Strung";
  const showConfigure =
    select.value.trim().toLowerCase() === trigger.trim().toLowerCase();

  actions.hidden = !showConfigure;
  actions.setAttribute("aria-hidden", showConfigure ? "false" : "true");
  syncConfigureButtonSlot(wrapper, showConfigure);

  if (shouldHideThemeBuyBox(wrapper)) {
    if (showConfigure) {
      refreshThemeBuyBoxHidden(true);
    } else {
      setThemeBuyBoxHidden(false);
      restoreAddToCartButtons();
    }
  } else if (!showConfigure) {
    restoreAddToCartButtons();
  }
}

function bindThemeStringingSelect(wrapper: HTMLElement) {
  const block = findThemeStringingBlock();
  if (!block || block.closest(".proto-configurator-button-wrapper")) return;

  const themeSelect = block.querySelector<HTMLSelectElement>("select");
  if (!themeSelect || themeSelect.dataset.protoStringingBound) return;
  themeSelect.dataset.protoStringingBound = "true";

  const sync = () => {
    const protoSelect = wrapper.querySelector<HTMLSelectElement>(
      "[data-proto-stringing-select]",
    );
    if (protoSelect && protoSelect !== themeSelect) {
      protoSelect.value = themeSelect.value;
    }
    updateStringingGate(wrapper);
  };

  themeSelect.addEventListener("change", sync);
  sync();
}

function initStringingGates() {
  document.querySelectorAll("[data-proto-stringing-gate]").forEach((wrapper) => {
    const el = wrapper as HTMLElement;
    if (el.dataset.stringingBound) {
      const themeBlock = findThemeStringingBlock();
      const themeSelect = themeBlock?.querySelector<HTMLSelectElement>("select");
      const protoSelect = el.querySelector<HTMLSelectElement>(
        "[data-proto-stringing-select]",
      );
      if (themeSelect && protoSelect && themeSelect !== protoSelect) {
        protoSelect.value = themeSelect.value;
      }
      updateStringingGate(el);
      return;
    }
    el.dataset.stringingBound = "true";

    const select = el.querySelector<HTMLSelectElement>(
      "[data-proto-stringing-select]",
    );
    if (!select) return;

    updateStringingGate(el);
    select.addEventListener("change", () => updateStringingGate(el));
    bindThemeStringingSelect(el);
  });
}

function initButtons() {
  document.querySelectorAll("[data-proto-configurator-trigger]").forEach((el) => {
    (el as HTMLElement).dataset.protoBound = "true";
  });
}

/** Fallback when the app embed is on but the theme block was not added. */
function injectProductPageButton() {
  const productId = window.ProtoConfiguratorSettings?.productId;
  if (!productId) return;
  if (document.querySelector(".proto-configurator-button-wrapper")) return;

  const insertParent = getProductInfoInsertPoint();
  if (!insertParent) return;

  const wrapper = createStringingGateWrapper(productId);
  wrapper.dataset.protoAutoInjected = "true";

  const insertBefore = insertParent.querySelector(
    ".product-form__quantity, quantity-input, .quantity-selector, button[name='add'], .product-form__submit, form[action*='/cart/add'], product-form",
  );
  if (insertBefore) {
    insertParent.insertBefore(wrapper, insertBefore);
  } else {
    insertParent.appendChild(wrapper);
  }

  initButtons();
}

function initShareRestore() {
  const params = new URLSearchParams(window.location.search);
  const shareId = params.get("proto_config");
  if (!shareId) return;

  const proxyUrl = getProxyUrl();
  const shop = getShopDomain();
  const query = shop ? `?shop=${encodeURIComponent(shop)}` : "";

  fetch(`${proxyUrl}/share/${shareId}${query}`)
    .then((r) => r.json())
    .then((data: {
      configurator?: StorefrontConfigurator;
      productId?: string;
      selections?: Record<string, string>;
      addons?: Record<string, number>;
    }) => {
      if (!data.configurator || !data.productId) return;
      useConfiguratorStore.getState().open(data.productId, data.configurator);
      if (data.selections && data.addons) {
        useConfiguratorStore
          .getState()
          .restoreFromShare(data.selections, data.addons);
      }
    })
    .catch(() => {});
}

async function initStorefrontUi() {
  const productId = getPageProductId();
  if (!productId) {
    initButtons();
    return;
  }

  markProductLinkagePending();
  const { configurator } = await fetchConfigurator(productId);
  if (!configurator) {
    markProductUnlinked();
    return;
  }

  markProductLinked();

  if (!document.querySelector(".proto-configurator-button-wrapper")) {
    injectProductPageButton();
  }
  scheduleConfiguratorRelocation();
  initStringingGates();
  initButtons();
}

function boot() {
  mount();
  initConfigureClickDelegation();
  initStringingGates();
  void initStorefrontUi();
  initShareRestore();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}

document.addEventListener("shopify:section:load", () => {
  initStringingGates();
  void initStorefrontUi();
});

window.addEventListener("pageshow", () => {
  initStringingGates();
});

window.ProtoConfigurator = {
  open: (productId, configurator) => {
    preloadImages(collectImageUrls(configurator)).then(() => {
      useConfiguratorStore.getState().open(productId, configurator);
    });
  },
  close: () => useConfiguratorStore.getState().close(),
};

export { getDefaultSelections };
