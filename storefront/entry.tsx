import { clearConfigureError, showConfigureError } from "./lib/configure-feedback";
import { normalizeProductId } from "./lib/product-id";
import { createStringingGateWrapper } from "./lib/stringing-gate";
import { initStringingPageGate } from "./lib/stringing-page-gate";
import { initV2StandaloneGate } from "./lib/v2-standalone-gate";
import {
  getPageProductId,
  markProductLinked,
  markProductLinkagePending,
  markProductUnlinked,
} from "./lib/product-linkage";
import {
  getProductInfoInsertPoint,
  invalidateThemeBlockCache,
  scheduleConfiguratorRelocation,
} from "./lib/theme-placement";
import type { StorefrontConfigurator } from "~/lib/configurator.types";
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
      channel?: string;
      modalUrl?: string;
    };
    /** Linkage fetch kicked off inline by the embed liquid during HTML parse (before this
     *  deferred bundle runs), so the network round-trip overlaps page load instead of following
     *  it. Consumed (once) by fetchConfiguratorAttempt. */
    ProtoConfiguratorEarlyFetch?: Promise<Response>;
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

/**
 * sessionStorage cache of the proxy payload, so REPEAT views of a product this session (back
 * button, browsing several racquets, variant-change section reloads) show the Configure button
 * instantly instead of waiting on the App Proxy round-trip every single time. The cached copy is
 * served immediately and silently revalidated in the background (see initStorefrontUi), so it can
 * never go stale for longer than one page view + TTL. Bump the version on payload shape changes.
 */
const SESSION_CACHE_VERSION = "v1";
const SESSION_CACHE_TTL_MS = 5 * 60 * 1000; // matches the proxy's own Cache-Control max-age

function sessionCacheKey(productId: string): string {
  return `proto_cfg_${SESSION_CACHE_VERSION}:${getShopDomain()}:${normalizeProductId(productId)}`;
}

function readSessionCache(productId: string): StorefrontConfigurator | null {
  try {
    const raw = window.sessionStorage.getItem(sessionCacheKey(productId));
    if (!raw) return null;
    const entry = JSON.parse(raw) as { at: number; configurator: StorefrontConfigurator };
    if (!entry?.configurator || Date.now() - entry.at > SESSION_CACHE_TTL_MS) return null;
    return entry.configurator;
  } catch {
    return null; // unavailable storage / corrupt entry — behave as a miss
  }
}

function writeSessionCache(productId: string, configurator: StorefrontConfigurator): void {
  try {
    window.sessionStorage.setItem(
      sessionCacheKey(productId),
      JSON.stringify({ at: Date.now(), configurator }),
    );
  } catch {
    // quota/unavailable — cache is best-effort
  }
}

function clearSessionCache(productId: string): void {
  try {
    window.sessionStorage.removeItem(sessionCacheKey(productId));
  } catch {
    // best-effort
  }
}

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

/** Per-attempt fetch timeout. Short on purpose: a hung attempt should fail fast and RETRY
 *  (see fetchConfigurator) instead of blocking the Configure button behind one 15s stall. */
const FETCH_ATTEMPT_TIMEOUT_MS = 7000;
/** Backoff before retry attempts 2 and 3. Transient App Proxy blips / serverless cold starts
 *  are routine; a quick retry converts most of them into a success instead of a dead button. */
const FETCH_RETRY_DELAYS_MS = [400, 1500];

/** One HTTP attempt. Uses the embed's early-fetch promise (kicked off inline in
 *  configurator-embed.liquid during HTML parse, before this deferred bundle even runs) for the
 *  first attempt when available — the response is typically already in flight or done by now. */
async function fetchConfiguratorAttempt(url: string): Promise<Response> {
  const early = window.ProtoConfiguratorEarlyFetch;
  if (early) {
    // Consume once; a failed early fetch must not poison retries.
    window.ProtoConfiguratorEarlyFetch = undefined;
    let timer = 0;
    const timeout = new Promise<never>((_, reject) => {
      timer = window.setTimeout(
        () => reject(new DOMException("timeout", "AbortError")),
        FETCH_ATTEMPT_TIMEOUT_MS,
      );
    });
    try {
      return await Promise.race([early, timeout]);
    } finally {
      // Prevent a late, unobserved rejection from the loser of the race.
      window.clearTimeout(timer);
    }
  }
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), FETCH_ATTEMPT_TIMEOUT_MS);
  try {
    return await fetch(url, {
      credentials: "same-origin",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
  } finally {
    window.clearTimeout(timeout);
  }
}

/**
 * Fetch the configurator for a product from the App Proxy (`GET /product/:id`).
 *
 * Reliability: up to 3 attempts (7s timeout each, short backoff between) — retrying on network
 * errors, timeouts, 5xx, and non-JSON responses (all transient failure modes of the
 * Shopify-proxy→serverless path). Definitive answers (success, or a 2xx/4xx JSON body saying
 * not-linked/inactive) are never retried.
 *
 * @returns `{ configurator }` on success, or `{ configurator: null, error, code? }`. `code` is
 *   set for DEFINITIVE negative answers ("not_linked" / "inactive") so callers can distinguish
 *   "this product really has no configurator" from a transient fetch failure.
 */
async function fetchConfigurator(
  productId: string,
): Promise<{ configurator: StorefrontConfigurator | null; error?: string; code?: string }> {
  const proxyUrl = getProxyUrl();
  const normalizedId = normalizeProductId(productId);
  const shop = getShopDomain();

  const query = new URLSearchParams();
  if (shop) query.set("shop", shop);

  const queryString = query.toString();
  const url = `${proxyUrl}/product/${normalizedId}${queryString ? `?${queryString}` : ""}`;

  let lastError = "Unable to reach the configurator. Please refresh the page and try again.";

  for (let attempt = 0; attempt <= FETCH_RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => window.setTimeout(r, FETCH_RETRY_DELAYS_MS[attempt - 1]));
    }
    try {
      const res = await fetchConfiguratorAttempt(url);
      const contentType = res.headers.get("content-type") ?? "";
      const raw = await res.text();

      // 5xx or non-JSON (e.g. an HTML error page from the proxy) — transient; retry.
      if (res.status >= 500 || !contentType.includes("application/json")) {
        lastError = "Unable to load configurator. Please refresh the page and try again.";
        continue;
      }

      const data = JSON.parse(raw) as {
        configurator?: StorefrontConfigurator | null;
        error?: string;
        code?: string;
        productId?: string;
      };

      if (!res.ok) {
        // Definitive 4xx — retrying won't change the answer.
        return {
          configurator: null,
          error: data.error ?? `Configurator request failed (${res.status})`,
          code: data.code,
        };
      }

      if (data.configurator) {
        return { configurator: data.configurator };
      }

      // 2xx with no configurator: a definitive "not linked / inactive" answer.
      return {
        configurator: null,
        error:
          data.error ??
          "Stringing configuration isn't available for this product right now. Please contact us for assistance.",
        code: data.code ?? "not_linked",
      };
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === "AbortError";
      lastError = aborted
        ? "Configurator request timed out. Please refresh the page and try again."
        : "Unable to reach the configurator. Please refresh the page and try again.";
      // network error / timeout — transient; retry.
    }
  }

  return { configurator: null, error: lastError };
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
  // The v2 "Configure Racquet" standalone button isn't part of the Strung/Unstrung gate and is
  // never wrapped in a gated actions container, so those checks don't apply to it — only its own
  // computed visibility matters.
  const standalone = trigger.hasAttribute("data-proto-v2-standalone");
  if (!standalone) {
    if (document.documentElement.dataset.protoStringingState === "unstrung") {
      return false;
    }
    const actions = trigger.closest("[data-proto-configurator-actions]");
    if (actions?.hasAttribute("hidden")) return false;
  }
  if (trigger.hasAttribute("hidden")) return false;
  const style = window.getComputedStyle(trigger);
  return style.display !== "none" && style.visibility !== "hidden" && style.pointerEvents !== "none";
}

/**
 * True when a v2 standalone "Configure Racquet" button is on the page. In this mode the app is
 * purely additive: it shows/hides its own button via linkage and opens the modal on click, and
 * does NONE of the buy-box relocation, Strung/Unstrung gating, or legacy-configurator suppression
 * — so it cannot interfere with the merchant's existing configurator or native Add to Cart.
 */
function isStandaloneV2Mode(): boolean {
  return Boolean(document.querySelector("[data-proto-v2-standalone]"));
}

/**
 * True inside the Shopify Theme Editor preview. The App Proxy (`/apps/…`) doesn't route to the
 * app in the editor, so the linkage round-trip that reveals the button can never resolve there —
 * without special-casing this, the button stays hidden in the editor and merchants can't see or
 * place the block even though it works on the live storefront.
 */
function isThemeEditor(): boolean {
  return Boolean(
    (window as unknown as { Shopify?: { designMode?: boolean } }).Shopify?.designMode,
  );
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
/** Apply the full "linked" UI state for a resolved configurator (button visible + wired). */
function applyLinkedUi(productId: string, configurator: StorefrontConfigurator) {
  configuratorCache.set(productId, configurator);
  markProductLinked();

  // Standalone v2 mode: the "Configure Racquet" button is fully self-contained. Skip every piece
  // of DOM surgery (fallback injection, buy-box relocation, Strung/Unstrung gate) — the block
  // renders in its own place and only needs the linkage class (applied above) to become visible,
  // plus the global click handler to open the modal.
  if (isStandaloneV2Mode()) {
    initV2StandaloneGate();
    initButtons();
    return;
  }

  if (!document.querySelector(".proto-configurator-button-wrapper")) {
    injectProductPageButton();
  }
  scheduleConfiguratorRelocation();
  initStringingPageGate();
  initButtons();
}

/**
 * Silently refresh a cache-served configurator from the proxy. Success updates both caches (so
 * prices/availability in the modal stay ≤ one page view stale). A DEFINITIVE negative answer
 * (code "not_linked"/"inactive" — the merchant unassigned this racquet or turned the
 * configurator off) drops the caches and hides the button. Transient failures (network/timeout,
 * no `code`) change nothing — the cached experience keeps working.
 */
async function revalidateConfigurator(productId: string) {
  const { configurator, code } = await fetchConfigurator(productId);
  if (configurator && configurator.theme.buttonEnabled !== false) {
    configuratorCache.set(productId, configurator);
    writeSessionCache(productId, configurator);
    return;
  }
  if (code || (configurator && configurator.theme.buttonEnabled === false)) {
    configuratorCache.delete(productId);
    clearSessionCache(productId);
    markProductUnlinked();
  }
}

async function initStorefrontUi() {
  const productId = getPageProductId();
  if (!productId) {
    initButtons();
    return;
  }

  // Cache-first: an in-memory hit (section:load re-run on the same page) or a sessionStorage hit
  // (back button / revisits this session) shows the button IMMEDIATELY — no pending-hide flash,
  // no App Proxy round-trip on the critical path — then revalidates silently in the background.
  const cached = configuratorCache.get(productId) ?? readSessionCache(productId);
  if (cached && cached.theme.buttonEnabled !== false) {
    applyLinkedUi(productId, cached);
    void revalidateConfigurator(productId);
    return;
  }

  markProductLinkagePending();
  const { configurator } = await fetchConfigurator(productId);
  if (!configurator) {
    // Theme Editor: linkage can't resolve here (the App Proxy doesn't run in the editor preview),
    // so a null result is EXPECTED, not "unlinked". Reveal the standalone button anyway so the
    // merchant can see and position the block; it gates normally on the live storefront where the
    // proxy works. (Only the self-contained v2 button — the legacy buy-box gate must never run in
    // the editor.) Non-editor: a null result genuinely means not linked → hide.
    if (isThemeEditor() && isStandaloneV2Mode()) {
      markProductLinked();
      initV2StandaloneGate();
      initButtons();
      return;
    }
    markProductUnlinked();
    return;
  }

  // Merchant-wide kill switch (Theme Settings > "Enable customize button globally").
  // Treat "disabled" the same as "no configurator" — hides the button and restores the
  // theme's native Add to Cart everywhere, regardless of any individual configurator's state.
  if (configurator.theme.buttonEnabled === false) {
    markProductUnlinked();
    return;
  }

  writeSessionCache(productId, configurator);
  applyLinkedUi(productId, configurator);
}

/**
 * One-time startup: wire click delegation + gate, run the linkage check, restore any share.
 * The React modal is NOT mounted here — it loads lazily on the first Configure click
 * (or immediately when a share link is present), keeping page-load JS tiny.
 */
function boot() {
  invalidateThemeBlockCache();
  initConfigureClickDelegation();
  // In standalone v2 mode the invasive gate must never run — it reads/writes global stringing
  // state and can restore the buy box. initV2StandaloneGate is the safe, read-only replacement
  // (see initStorefrontUi, called once linkage confirms the button should exist at all).
  if (!isStandaloneV2Mode()) initStringingPageGate();
  void initStorefrontUi();
  initShareRestore();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}

document.addEventListener("shopify:section:load", () => {
  invalidateThemeBlockCache();
  if (!isStandaloneV2Mode()) initStringingPageGate();
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
