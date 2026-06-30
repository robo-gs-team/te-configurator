import { createRoot, type Root } from "react-dom/client";
import { ConfiguratorErrorBoundary } from "./components/ConfiguratorErrorBoundary";
import { ConfiguratorModal } from "./components/ConfiguratorModal";
import { useConfiguratorStore } from "./store/configurator-store";
import { clearConfigureError, showConfigureError } from "./lib/configure-feedback";
import { collectImageUrls, preloadImages } from "./lib/image-preloader";
import { normalizeProductId } from "./lib/product-id";
import { createStringingGateWrapper } from "./lib/stringing-gate";
import { initStringingPageGate } from "./lib/stringing-page-gate";
import {
  getPageProductId,
  markProductLinked,
  markProductLinkagePending,
  markProductUnlinked,
} from "./lib/product-linkage";
import {
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

/**
 * entry.tsx
 *
 * The storefront bundle's entry point. Loaded (deferred) by the App Embed on every page where
 * the embed is enabled. Responsibilities:
 *   - mount the React modal root on <body>
 *   - decide whether this product has a configurator (linkage check) and reveal/inject the
 *     Configure button accordingly
 *   - wire up the Strung/Unstrung gate and the global Configure-click handler
 *   - open the modal on click (using cached data so it's instant)
 *   - restore a shared configuration from a `?proto_config=` URL
 *
 * It exposes a small `window.ProtoConfigurator` API ({ open, close }) for external callers.
 */

/** The single React root hosting the modal; created once on first mount. */
let reactRoot: Root | null = null;

// Cache configurator data per productId so the Configure button click is instant
// (avoids a second API round-trip after initStorefrontUi already fetched it).
const configuratorCache = new Map<string, StorefrontConfigurator>();

/** Root React tree: the modal wrapped in an error boundary. */
function App() {
  return (
    <ConfiguratorErrorBoundary>
      <ConfiguratorModal />
    </ConfiguratorErrorBoundary>
  );
}

/** Ensure the `#proto-configurator-root` element exists on <body> and render the App into it. */
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

/** Resolve the shop domain from embed settings, falling back to window.Shopify.shop. */
function getShopDomain(): string {
  return (
    window.ProtoConfiguratorSettings?.shopDomain ??
    window.Shopify?.shop ??
    ""
  );
}

/** Resolve the App Proxy base URL from embed settings (default `/apps/proto-configurator`). */
function getProxyUrl(): string {
  return window.ProtoConfiguratorSettings?.appProxyUrl ?? "/apps/proto-configurator";
}

/**
 * Fetch the configurator for a product from the App Proxy (`GET /product/:id`).
 *
 * Aborts after 15s, requires a JSON response, and maps every failure mode to a shopper-facing
 * `error` string. A null configurator with no error means "no configurator linked".
 * @returns `{ configurator }` on success, or `{ configurator: null, error }` otherwise.
 */
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

/** Toggle the Configure button's loading state (disabled + busy + wait cursor) during fetch. */
function setTriggerLoading(trigger: HTMLElement, loading: boolean) {
  trigger.toggleAttribute("disabled", loading);
  trigger.setAttribute("aria-busy", loading ? "true" : "false");
  trigger.style.opacity = loading ? "0.75" : "";
  trigger.style.cursor = loading ? "wait" : "pointer";
}

/**
 * Open the modal for a product. Uses the per-product cache for an instant open when available;
 * otherwise shows a loading state on the button, fetches, caches, and opens. Surfaces any error
 * inline on the button. Also preloads option images so the modal renders without pop-in.
 */
async function openConfigurator(productId: string, trigger: HTMLElement) {
  clearConfigureError(trigger);

  // Use cached data if available — avoids a second API round-trip
  const cached = configuratorCache.get(productId);
  if (cached) {
    useConfiguratorStore.getState().open(productId, cached);
    void preloadImages(collectImageUrls(cached)).catch(() => {});
    return;
  }

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

    configuratorCache.set(productId, configurator);
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

/**
 * Guard for click handling: is this Configure trigger actually meant to be interactive right
 * now? False when the global state is "unstrung", the actions are hidden, or CSS has hidden the
 * button — prevents acting on a click that landed on a visually-hidden button.
 */
function isConfigureTriggerVisible(trigger: HTMLElement): boolean {
  if (document.documentElement.dataset.protoStringingState === "unstrung") {
    return false;
  }
  const actions = trigger.closest("[data-proto-configurator-actions]");
  if (actions?.hasAttribute("hidden")) return false;
  if (trigger.hasAttribute("hidden")) return false;
  const style = window.getComputedStyle(trigger);
  return style.display !== "none" && style.visibility !== "hidden" && style.pointerEvents !== "none";
}

/**
 * Handle a Configure click: bail if not visible, otherwise prevent the default/native action,
 * resolve the product id (from the button or embed settings), and open the configurator.
 */
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

/**
 * Install a single capture-phase click listener on <html> that delegates to handleConfigureClick
 * for any `[data-proto-configurator-trigger]`. Delegation (rather than per-button listeners)
 * keeps it working even after the button is relocated in the DOM. Bound at most once.
 */
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

/** Mark all existing trigger buttons as bound (a simple presence flag; clicks use delegation). */
function initButtons() {
  document.querySelectorAll("[data-proto-configurator-trigger]").forEach((el) => {
    (el as HTMLElement).dataset.protoBound = "true";
  });
}

/**
 * Fallback when the app embed is on but the theme block was not added: build a gate wrapper in
 * JS (createStringingGateWrapper) and insert it into the product info / buy box. No-op if a
 * wrapper already exists or no product id / insert point is found.
 */
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

/**
 * If the URL carries `?proto_config={shareId}`, fetch that saved configuration from the proxy
 * (`GET /share/:id`) and open the modal with its selections restored. Silently does nothing if
 * the param is absent or the fetch fails.
 */
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

/**
 * The on-load linkage routine: find the page's product id, mark linkage pending, and fetch the
 * configurator. If none is linked, mark unlinked (hides the button). If one is linked, cache it,
 * mark linked, inject the fallback button if needed, schedule placement, and init the gate.
 * This is what decides whether the Configure button appears on this product page.
 */
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

  // Cache so the Configure button click is instant — no second round-trip
  configuratorCache.set(productId, configurator);
  markProductLinked();

  if (!document.querySelector(".proto-configurator-button-wrapper")) {
    injectProductPageButton();
  }
  scheduleConfiguratorRelocation();
  initStringingPageGate();
  initButtons();
}

/** One-time startup: mount the modal root, wire click delegation + gate, run linkage, restore share. */
function boot() {
  mount();
  initConfigureClickDelegation();
  initStringingPageGate();
  void initStorefrontUi();
  initShareRestore();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}

document.addEventListener("shopify:section:load", () => {
  initStringingPageGate();
  void initStorefrontUi();
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
