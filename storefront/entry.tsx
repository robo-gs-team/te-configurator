import { clearConfigureError, showConfigureError } from "./lib/configure-feedback";
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
import type { ProtoConfiguratorModalApi } from "./modal-entry";
import "./styles.css";

declare global {
  interface Window {
    ProtoConfigurator?: {
      open: (productId: string, configurator: StorefrontConfigurator) => void;
      close: () => void;
    };
    ProtoConfiguratorModal?: ProtoConfiguratorModalApi;
    ProtoConfiguratorSettings?: {
      appProxyUrl: string;
      productId: string;
      shopDomain?: string;
      modalUrl?: string;
    };
    Shopify?: {
      shop?: string;
    };
  }
}

/**
 * entry.tsx
 *
 * The storefront bundle's tiny entry point. Loaded (deferred) by the App Embed on every page
 * where the embed is enabled. Deliberately carries NO React — that lives in the separate
 * proto-configurator-modal.js bundle, loaded lazily on first interaction. Responsibilities:
 *   - decide whether this product has a configurator (linkage check) and reveal/inject the
 *     Configure button accordingly
 *   - wire up the Strung/Unstrung gate and the global Configure-click handler
 *   - on the first Configure click, lazy-load the modal bundle, then open it (with cached data)
 *   - restore a shared configuration from a `?proto_config=` URL (also lazy-loads the modal)
 *
 * It exposes a small `window.ProtoConfigurator` API ({ open, close }) for external callers.
 */

// Cache configurator data per productId so the Configure button click is instant
// (avoids a second API round-trip after initStorefrontUi already fetched it).
const configuratorCache = new Map<string, StorefrontConfigurator>();

// In-flight promise for the lazy modal bundle so concurrent triggers share one load.
let modalLoadPromise: Promise<ProtoConfiguratorModalApi> | null = null;

/** Resolve the modal bundle URL from embed settings (set by the App Embed liquid). */
function getModalUrl(): string {
  return window.ProtoConfiguratorSettings?.modalUrl ?? "";
}

/**
 * Lazy-load the heavy modal bundle (React + store + modal UI) on first interaction.
 * Injects a <script> for proto-configurator-modal.js, which assigns window.ProtoConfiguratorModal.
 * Subsequent calls resolve instantly from the cached promise / already-present global.
 */
function loadModal(): Promise<ProtoConfiguratorModalApi> {
  if (window.ProtoConfiguratorModal) {
    return Promise.resolve(window.ProtoConfiguratorModal);
  }
  if (modalLoadPromise) return modalLoadPromise;

  modalLoadPromise = new Promise<ProtoConfiguratorModalApi>((resolve, reject) => {
    const url = getModalUrl();
    if (!url) {
      reject(new Error("Configurator modal URL is not configured."));
      return;
    }
    const script = document.createElement("script");
    script.src = url;
    script.async = true;
    script.onload = () => {
      if (window.ProtoConfiguratorModal) {
        resolve(window.ProtoConfiguratorModal);
      } else {
        reject(new Error("Configurator modal failed to initialize."));
      }
    };
    script.onerror = () => reject(new Error("Configurator modal failed to load."));
    document.head.appendChild(script);
  });

  // Let a failed load be retried on the next click.
  modalLoadPromise.catch(() => {
    modalLoadPromise = null;
  });

  return modalLoadPromise;
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
        error: "Unable to load configurator. Please refresh the page and try again.",
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
      error: "Stringing configuration isn't available for this product right now. Please contact us for assistance.",
    };
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === "AbortError";
    return {
      configurator: null,
      error: aborted
        ? "Configurator request timed out. Please refresh the page and try again."
        : "Unable to reach the configurator. Please refresh the page and try again.",
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
  setTriggerLoading(trigger, true);

  try {
    // Resolve the configurator data (cached from the on-load linkage check when possible)
    // and lazy-load the modal bundle in parallel — both must be ready before we open.
    let configurator = configuratorCache.get(productId);
    if (!configurator) {
      const result = await fetchConfigurator(productId);
      if (result.error) {
        showConfigureError(trigger, result.error);
        return;
      }
      if (!result.configurator) {
        showConfigureError(
          trigger,
          "Stringing configuration isn't available for this product right now. Please contact us for assistance.",
        );
        return;
      }
      configurator = result.configurator;
      configuratorCache.set(productId, configurator);
    }

    const modal = await loadModal();
    modal.open(productId, configurator);
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
    .then(async (data: {
      configurator?: StorefrontConfigurator;
      productId?: string;
      selections?: Record<string, string>;
      addons?: Record<string, number>;
    }) => {
      if (!data.configurator || !data.productId) return;
      // A share link is an explicit request to view a configuration, so loading the
      // modal bundle here is expected (not a lazy-load regression).
      const modal = await loadModal();
      modal.restoreShare(
        data.productId,
        data.configurator,
        data.selections,
        data.addons,
      );
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

/**
 * One-time startup: wire click delegation + gate, run the linkage check, restore any share.
 * The React modal is NOT mounted here — it loads lazily on the first Configure click
 * (or immediately when a share link is present), keeping page-load JS tiny.
 */
function boot() {
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
    configuratorCache.set(productId, configurator);
    loadModal()
      .then((modal) => modal.open(productId, configurator))
      .catch((err) => {
        // e.g. modalUrl not configured on an older embed — don't leave an unhandled rejection.
        console.error("ProtoConfigurator.open failed to load the modal:", err);
      });
  },
  close: () => {
    window.ProtoConfiguratorModal?.close();
  },
};

export { getDefaultSelections };
