import {
  clearAllConfigureLoadingNotes,
  clearConfigureError,
  clearConfigureLoadingNote,
  showConfigureError,
  startConfigureLoadingNote,
} from "./lib/configure-feedback";
import { normalizeProductId } from "./lib/product-id";
import { createStringingGateWrapper } from "./lib/stringing-gate";
import { initStringingPageGate } from "./lib/stringing-page-gate";
import { initV2StandaloneGate, ensureStringingIsStrung } from "./lib/v2-standalone-gate";
import { neutralizeInertOverlays } from "./lib/inert-overlays";
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
// Page-load CSS is the tiny entry.css only. The full modal stylesheet ships inside the lazy
// modal bundle (see modal-entry.tsx) — it used to be imported here, which put ~33KB of
// render-blocking, modal-only CSS on every racquet PDP.
import "./entry.css";

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
    /** Linkage-check fetch kicked off inline by the embed liquid during HTML parse (before this
     *  deferred bundle runs), so the network round-trip overlaps page load instead of following
     *  it. Targets the LIGHT `/product/:id/link` endpoint (~100 bytes), not the full catalog —
     *  see fetchLinkageAttempt. Consumed (once) by it. */
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
 * proto-configurator-modal.js bundle, loaded lazily on first interaction.
 *
 * Split-phase fetch: page load only ever asks the App Proxy "is this product linked?" (~100
 * bytes) — never the full string catalog, which used to ship on EVERY product page view just to
 * decide whether to show a button. The full catalog is fetched separately, warmed in the
 * background (idle + hover/touch/focus "intent" signals) once linkage confirms the button should
 * exist, with a same-click fallback fetch if neither warm-up finished in time. Responsibilities:
 *   - decide whether this product has a configurator (linkage check) and reveal/inject the
 *     Configure button accordingly
 *   - wire up the Strung/Unstrung gate and the global Configure-click handler
 *   - warm the full catalog + modal bundle in the background once linked, so a real click is
 *     instant in the overwhelming majority of cases
 *   - on the first Configure click, ensure the full catalog + modal bundle are ready, then open
 *   - restore a shared configuration from a `?proto_config=` URL (also lazy-loads the modal)
 *
 * It exposes a small `window.ProtoConfigurator` API ({ open, close }) for external callers.
 */

// In-memory cache of the FULL catalog per productId, once fetched — click is instant afterward
// (avoids a second API round-trip after it's already been fetched once this page view).
const configuratorCache = new Map<string, StorefrontConfigurator>();

/**
 * sessionStorage cache of the FULL catalog payload, so REPEAT views of a product this session
 * (back button, browsing several racquets, variant-change section reloads) that have ALREADY
 * fetched the full catalog once don't refetch it. Served immediately and silently revalidated in
 * the background (see revalidateConfigurator), so it can never go stale for longer than one page
 * view + TTL. Bump the version on payload shape changes.
 */
const SESSION_CACHE_VERSION = "v1";
// 30 min: repeat browsing — comparing several racquets over many minutes, back/forward — keeps
// using the cached catalog instead of re-fetching. Safe to lengthen because a served copy is
// silently revalidated in the background on every view that shows it.
const SESSION_CACHE_TTL_MS = 30 * 60 * 1000;

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

/**
 * sessionStorage cache of the LINKAGE-ONLY answer (linked boolean + definitive code), separate
 * from the full-catalog cache above. This is what makes repeat views of the vast majority of a
 * general store's product pages — anything with NO configurator — cost zero network requests
 * after the first: a cached definitive negative hides the button with no round-trip at all.
 * Positive and negative entries use different TTLs (see below).
 */
const LINK_CACHE_VERSION = "v1";
// Matches the full-catalog cache's TTL — a positive linkage result is silently re-checked in the
// background on every view anyway (see revalidateLinkage), so it can't actually go stale to the
// shopper for longer than one page view.
const LINK_CACHE_POSITIVE_TTL_MS = 30 * 60 * 1000;
// Shorter than the positive TTL: a cached NEGATIVE result skips the round-trip entirely (there's
// nothing to reveal, so no background revalidation runs against a hidden button) — bounding this
// more tightly limits how long a newly-linked product could still read as "not linked" from a
// stale cache entry, while still eliminating the round-trip for most of a session.
const LINK_CACHE_NEGATIVE_TTL_MS = 10 * 60 * 1000;

type LinkCacheEntry = { at: number; linked: boolean; code?: string };

function linkCacheKey(productId: string): string {
  return `proto_link_${LINK_CACHE_VERSION}:${getShopDomain()}:${normalizeProductId(productId)}`;
}

function readLinkCache(productId: string): LinkCacheEntry | null {
  try {
    const raw = window.sessionStorage.getItem(linkCacheKey(productId));
    if (!raw) return null;
    const entry = JSON.parse(raw) as LinkCacheEntry;
    if (typeof entry?.linked !== "boolean") return null;
    const ttl = entry.linked ? LINK_CACHE_POSITIVE_TTL_MS : LINK_CACHE_NEGATIVE_TTL_MS;
    if (Date.now() - entry.at > ttl) return null;
    return entry;
  } catch {
    return null;
  }
}

function writeLinkCache(productId: string, data: { linked: boolean; code?: string }): void {
  try {
    window.sessionStorage.setItem(
      linkCacheKey(productId),
      JSON.stringify({ at: Date.now(), ...data } satisfies LinkCacheEntry),
    );
  } catch {
    // best-effort
  }
}

function clearLinkCache(productId: string): void {
  try {
    window.sessionStorage.removeItem(linkCacheKey(productId));
  } catch {
    // best-effort
  }
}

// In-flight promise for the lazy modal bundle so concurrent triggers share one load.
let modalLoadPromise: Promise<ProtoConfiguratorModalApi> | null = null;

/** Ceiling on the lazy modal-bundle <script> load. Generous (it's ~190KB and only fetched on a
 *  real click), but bounded — see loadModal for why an unbounded wait is a dead button. */
const MODAL_LOAD_TIMEOUT_MS = 20000;

/**
 * Hard ceiling on the WHOLE click → modal sequence (catalog + modal bundle in parallel).
 *
 * The full catalog payload is large (~250KB+) and Shopify's App Proxy can add several seconds of
 * latency on preview/storefront, so this must clear the per-attempt fetch budget with room to
 * spare. Without a wall-clock cap the button can spin until the shopper gives up.
 */
const OPEN_DEADLINE_MS = 30000;

/** True while openConfigurator is running — blocks duplicate opens and freezes buy-box relocation. */
let openInFlight: Promise<void> | null = null;

/** Reject with `message` if `promise` has not settled within `ms`. */
function withDeadline<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => { window.clearTimeout(timer); resolve(value); },
      (error) => { window.clearTimeout(timer); reject(error); },
    );
  });
}

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
    // A stalled script request fires NEITHER onload nor onerror — without this timeout the click
    // handler awaits forever and the button is left permanently disabled + spinning (its `finally`
    // never runs). Failing here instead surfaces a retryable error on the button.
    const timer = window.setTimeout(() => {
      reject(new Error("Configurator is taking too long to load. Please try again."));
    }, MODAL_LOAD_TIMEOUT_MS);
    script.onload = () => {
      window.clearTimeout(timer);
      if (window.ProtoConfiguratorModal) {
        resolve(window.ProtoConfiguratorModal);
      } else {
        reject(new Error("Configurator modal failed to initialize."));
      }
    };
    script.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error("Configurator modal failed to load."));
    };
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

/** Per-attempt fetch timeout. The full catalog JSON is large and App Proxy transfer on a real
 *  storefront/preview often lands in the 8–15s range — a 7s abort made every attempt fail, so the
 *  click path either spun through retries or hit the open deadline with nothing cached. */
const FETCH_ATTEMPT_TIMEOUT_MS = 20000;
/** Backoff before retry attempts 2 and 3. Transient App Proxy blips / serverless cold starts
 *  are routine; a quick retry converts most of them into a success instead of a dead button. */
const FETCH_RETRY_DELAYS_MS = [500, 1500];

function buildProductUrl(productId: string, suffix: ""): string;
function buildProductUrl(productId: string, suffix: "/link"): string;
function buildProductUrl(productId: string, suffix: "" | "/link"): string {
  const proxyUrl = getProxyUrl();
  const normalizedId = normalizeProductId(productId);
  const shop = getShopDomain();
  const query = new URLSearchParams();
  if (shop) query.set("shop", shop);
  const queryString = query.toString();
  return `${proxyUrl}/product/${normalizedId}${suffix}${queryString ? `?${queryString}` : ""}`;
}

/** One HTTP attempt against `url`, racing an optional early-fetch promise (kicked off inline in
 *  configurator-embed.liquid during HTML parse, before this deferred bundle even runs) — the
 *  response is typically already in flight or done by now. */
async function fetchAttempt(
  url: string,
  early?: Promise<Response>,
  lowPriority = false,
): Promise<Response> {
  if (early) {
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
    const init: RequestInit & { priority?: "low" } = {
      credentials: "same-origin",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    };
    // Background warm-ups yield to the page's own resources where the browser supports fetch
    // priority (Chromium). Unknown members of RequestInit are ignored elsewhere — safe everywhere.
    if (lowPriority) init.priority = "low";
    return await fetch(url, init);
  } finally {
    window.clearTimeout(timeout);
  }
}

/**
 * Fetch the LINKAGE-ONLY status for a product from the App Proxy (`GET /product/:id/link`) —
 * phase 1 of the split-phase fetch. Consumes the embed's early-fetch (which now targets this
 * endpoint, not the full catalog). Same retry semantics as the full fetch below: up to 3
 * attempts, retrying network errors/timeouts/5xx/non-JSON; a definitive answer (linked, or a
 * `code`d negative) is never retried.
 *
 * @returns `{ linked: true }` on success, `{ linked: false, code }` for a DEFINITIVE negative
 *   ("not_linked" / "inactive" / "button_disabled"), or `{ linked: false, error }` (no code) for
 *   a transient failure — callers use the presence of `code` to distinguish the two.
 */
async function fetchLinkage(
  productId: string,
): Promise<{ linked: boolean; code?: string; error?: string }> {
  const url = buildProductUrl(productId, "/link");
  let lastError = "Unable to reach the configurator. Please refresh the page and try again.";

  for (let attempt = 0; attempt <= FETCH_RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => window.setTimeout(r, FETCH_RETRY_DELAYS_MS[attempt - 1]));
    }
    try {
      const early = attempt === 0 ? window.ProtoConfiguratorEarlyFetch : undefined;
      if (early) window.ProtoConfiguratorEarlyFetch = undefined; // consume once
      const res = await fetchAttempt(url, early);
      const contentType = res.headers.get("content-type") ?? "";
      const raw = await res.text();

      if (res.status >= 500 || !contentType.includes("application/json")) {
        lastError = "Unable to load configurator. Please refresh the page and try again.";
        continue;
      }

      const data = JSON.parse(raw) as { linked?: boolean; code?: string };
      if (data.linked) return { linked: true };
      return { linked: false, code: data.code };
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === "AbortError";
      lastError = aborted
        ? "Configurator request timed out. Please refresh the page and try again."
        : "Unable to reach the configurator. Please refresh the page and try again.";
    }
  }

  return { linked: false, error: lastError };
}

/**
 * Fetch the FULL configurator catalog for a product from the App Proxy (`GET /product/:id`) —
 * phase 2 of the split-phase fetch, used once the shopper shows intent (hover/touch/focus/click)
 * rather than unconditionally on every page load. Endpoint and response shape unchanged from
 * before the split — only the trigger moved.
 *
 * Reliability: up to 3 attempts (7s timeout each, short backoff between) — retrying on network
 * errors, timeouts, 5xx, and non-JSON responses. Definitive answers (success, or a 2xx/4xx JSON
 * body saying not-linked/inactive) are never retried.
 *
 * @returns `{ configurator }` on success, or `{ configurator: null, error, code? }`. `code` is
 *   set for DEFINITIVE negative answers so callers can distinguish "this product really has no
 *   configurator" from a transient fetch failure.
 */
async function fetchFullConfigurator(
  productId: string,
  lowPriority = false,
): Promise<{ configurator: StorefrontConfigurator | null; error?: string; code?: string }> {
  const url = buildProductUrl(productId, "");
  let lastError = "Unable to reach the configurator. Please refresh the page and try again.";

  for (let attempt = 0; attempt <= FETCH_RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => window.setTimeout(r, FETCH_RETRY_DELAYS_MS[attempt - 1]));
    }
    try {
      const res = await fetchAttempt(url, undefined, lowPriority);
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

// In-flight full-catalog fetch per productId, so a hover-triggered warm-up and a subsequent real
// click share ONE request instead of firing two.
const fullCatalogInFlight = new Map<
  string,
  Promise<{ configurator: StorefrontConfigurator | null; error?: string; code?: string }>
>();

/**
 * Resolve the full catalog for a product: in-memory cache, then sessionStorage cache, then an
 * in-flight fetch already started by a warm-up, then a fresh fetch — in that order, never doing
 * more than one network request at a time per product. Every caller (background warm-up on
 * idle/hover, and the click handler's fallback) goes through this single path, so the two can
 * never race into duplicate requests.
 */
function fetchAndCacheFullCatalog(
  productId: string,
  lowPriority = false,
): Promise<{ configurator: StorefrontConfigurator | null; error?: string; code?: string }> {
  const cached = configuratorCache.get(productId) ?? readSessionCache(productId);
  if (cached) {
    configuratorCache.set(productId, cached);
    return Promise.resolve({ configurator: cached });
  }

  const inFlight = fullCatalogInFlight.get(productId);
  if (inFlight) return inFlight;

  const promise = fetchFullConfigurator(productId, lowPriority).then((result) => {
    if (result.configurator) {
      configuratorCache.set(productId, result.configurator);
      writeSessionCache(productId, result.configurator);
    }
    return result;
  });
  fullCatalogInFlight.set(productId, promise);
  void promise.finally(() => {
    // Only clear if this is still the tracked promise (a newer call could have replaced it).
    if (fullCatalogInFlight.get(productId) === promise) fullCatalogInFlight.delete(productId);
  });
  return promise;
}

/**
 * Fire-and-forget background warm-up of the full catalog — failures are silently swallowed
 * (nothing is cached on failure, so a later real click/warm-up attempt will genuinely retry
 * rather than getting stuck on a cached failure). Safe to call unconditionally and repeatedly:
 * fetchAndCacheFullCatalog short-circuits to zero network work once cached or already in flight.
 */
function prefetchFullCatalog(productId: string, lowPriority = false): void {
  void fetchAndCacheFullCatalog(productId, lowPriority).catch(() => {});
}

/** Toggle the Configure button's loading state during fetch.
 *
 * Do NOT use the HTML `disabled` attribute here — the theme's sold-out / Sticky ATC scripts also
 * write `disabled`, and fighting that in a MutationObserver either freezes the PDP or gives up
 * and leaves Configure permanently unclickable. Loading is signaled with aria-busy + a class
 * (pointer-events: none via entry.css) instead.
 */
function setTriggerLoading(trigger: HTMLElement, loading: boolean) {
  trigger.setAttribute("aria-busy", loading ? "true" : "false");
  trigger.classList.toggle("proto-configure-loading", loading);
  trigger.style.opacity = loading ? "0.75" : "";
  trigger.style.cursor = loading ? "wait" : "pointer";
  // Ensure theme-applied disabled never blocks the next click after loading ends.
  if (!loading) {
    trigger.removeAttribute("disabled");
    trigger.removeAttribute("aria-disabled");
  }
  // `cursor: wait` is invisible on touch, so a phone shopper saw only a faint dim. Arm a delayed
  // text note as the mobile-visible half of this state (see configure-feedback.ts — it stays
  // silent for the fast/warmed path and only surfaces on a genuinely long wait).
  if (loading) startConfigureLoadingNote(trigger);
  else clearConfigureLoadingNote(trigger);
}

/** Resolve a Configure trigger from a click/pointer target (button, label child, or wrapper). */
function resolveConfigureTrigger(target: Element): HTMLElement | null {
  const direct = target.closest<HTMLElement>("[data-proto-configurator-trigger]");
  if (direct) return direct;
  const wrap = target.closest<HTMLElement>(
    ".proto-v2-standalone-wrapper, .proto-configurator-button-wrapper",
  );
  return wrap?.querySelector<HTMLElement>("[data-proto-configurator-trigger]") ?? null;
}

/**
 * Like resolveConfigureTrigger, but if the event hit an empty full-screen promo shell (Alia)
 * sitting above Configure, neutralize it and re-hit-test so the real button can be found.
 */
function resolveConfigureTriggerFromEvent(event: Event): HTMLElement | null {
  // Always re-assert first — Alia may have rewritten style="" since the last pass.
  neutralizeInertOverlays();

  const target = event.target;
  if (!(target instanceof Element)) return null;

  const direct = resolveConfigureTrigger(target);
  if (direct) return direct;

  if (!("clientX" in event) || !("clientY" in event)) return null;
  const x = (event as PointerEvent | MouseEvent).clientX;
  const y = (event as PointerEvent | MouseEvent).clientY;
  if (typeof x !== "number" || typeof y !== "number") return null;
  const under = document.elementFromPoint(x, y);
  return under ? resolveConfigureTrigger(under) : null;
}

/**
 * Open the modal for a product. Uses the full-catalog cache (or an in-flight warm-up already
 * started by hover/idle) for an instant-or-near-instant open in the common case; otherwise shows
 * a loading state on the button while fetchAndCacheFullCatalog does a fresh fetch. Surfaces any
 * error inline on the button.
 *
 * Catalog fetch and modal-bundle load run in PARALLEL under one shared wall-clock deadline from
 * click time — sequential awaits used to stack two 12s caps (~24s cold worst case) and paid
 * modal download only after the catalog finished.
 */
async function openConfigurator(productId: string, trigger: HTMLElement) {
  clearConfigureError(trigger);
  setTriggerLoading(trigger, true);
  // Freeze v2 buy-box relocation while we open — MutationObserver re-runs can move/hide the
  // trigger mid-click and make the open look like a no-op, or detach the feedback host.
  document.documentElement.dataset.protoConfiguring = "1";

  try {
    // Theme editor: Shopify does not route App Proxy (/apps/...) requests inside the editor
    // preview, so the catalog fetch here is guaranteed to fail — but only AFTER burning the full
    // retry budget, which is what made the editor feel broken and slow. Say so immediately.
    if (isThemeEditor()) {
      showConfigureError(
        trigger,
        "The configurator can't open inside the theme editor — Shopify doesn't route app requests here. Use Preview to test it on your storefront.",
      );
      return;
    }

    const started = Date.now();
    const deadlineMsg = "Couldn't load the configurator in time. Please try again.";
    const remaining = () => Math.max(500, OPEN_DEADLINE_MS - (Date.now() - started));

    // Kick both off immediately so the modal script downloads while the catalog is fetching.
    const catalogPromise = fetchAndCacheFullCatalog(productId);
    const modalPromise = loadModal();

    const [result, modal] = await Promise.all([
      withDeadline(catalogPromise, remaining(), deadlineMsg),
      withDeadline(modalPromise, remaining(), deadlineMsg),
    ]);

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

    modal.open(productId, result.configurator);
  } catch (err) {
    showConfigureError(
      trigger,
      err instanceof Error ? err.message : "Failed to open configurator.",
    );
  } finally {
    delete document.documentElement.dataset.protoConfiguring;
    // Always clear loading UI — even if the trigger node was relocated mid-open, wipe any
    // leftover "Loading your options…" notes still in the buy box.
    setTriggerLoading(trigger, false);
    clearAllConfigureLoadingNotes();
    // Theme stock scripts may have flipped disabled while we were busy; restore clickability.
    protectConfigureTrigger(trigger);
  }
}

/**
 * Guard for click handling: is this Configure trigger actually meant to be interactive right
 * now? False when the global state is "unstrung", the actions are hidden, or CSS has hidden the
 * button — prevents acting on a click that landed on a visually-hidden button.
 */
function isConfigureTriggerVisible(trigger: HTMLElement): boolean {
  // Standalone Configure is hidden on Unstrung via proto-v2-hide-unstrung / display:none.
  const standalone = trigger.hasAttribute("data-proto-v2-standalone");
  if (standalone) {
    if (trigger.hasAttribute("hidden")) return false;
    const wrap = trigger.closest<HTMLElement>(".proto-v2-standalone-wrapper");
    if (wrap?.hasAttribute("hidden")) return false;
    if (wrap?.classList.contains("proto-v2-hide-unstrung")) return false;
    return trigger.isConnected;
  }

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
 * Handle a Configure click: always claim the event on our trigger (so theme handlers don't also
 * fire), skip duplicate opens, bail with feedback when the button isn't meant to be interactive,
 * then resolve the product id and open the configurator.
 */
function handleConfigureClick(trigger: HTMLElement, event: Event) {
  // Always claim the click on our trigger — even if we then decide not to open. A silent early
  // return used to leave preventDefault uncalled, so a half-hidden / mid-relocate button could
  // look clickable and do nothing (or let a theme Configure win). stopImmediatePropagation so
  // theme listeners on the same node/ancestors cannot open the legacy popup instead.
  event.preventDefault();
  event.stopPropagation();
  if (typeof event.stopImmediatePropagation === "function") {
    event.stopImmediatePropagation();
  }

  if (trigger.getAttribute("aria-busy") === "true" || openInFlight) return;

  if (!isConfigureTriggerVisible(trigger)) {
    return;
  }

  // Default stringing is Unstrung — switch to Strung so theme ATC state matches a configured buy.
  if (ensureStringingIsStrung()) {
    // Let theme product-configurator.js react before we open (it rewrites buy-buttons).
    window.setTimeout(() => {
      if (openInFlight || trigger.getAttribute("aria-busy") === "true") return;
      const productId =
        trigger.dataset.productId ??
        window.ProtoConfiguratorSettings?.productId ??
        "";
      if (!productId) {
        showConfigureError(trigger, "Product ID is missing on this page.");
        return;
      }
      openInFlight = openConfigurator(String(productId), trigger).finally(() => {
        openInFlight = null;
      });
    }, 50);
    return;
  }

  const productId =
    trigger.dataset.productId ??
    window.ProtoConfiguratorSettings?.productId ??
    "";

  if (!productId) {
    showConfigureError(trigger, "Product ID is missing on this page.");
    return;
  }

  openInFlight = openConfigurator(String(productId), trigger).finally(() => {
    openInFlight = null;
  });
}

/**
 * Install a single capture-phase click listener on <html> that delegates to handleConfigureClick
 * for any `[data-proto-configurator-trigger]`. Delegation (rather than per-button listeners)
 * keeps it working even after the button is relocated in the DOM. Bound at most once.
 */
function initConfigureClickDelegation() {
  if (document.documentElement.dataset.protoClickDelegated) return;
  document.documentElement.dataset.protoClickDelegated = "true";

  // Undo theme sold-out disables on the way in — before click — so a disabled <button> still
  // receives the subsequent click (disabled controls skip pointer events otherwise).
  // Also punch through empty Alia promo shells that cover Configure at max z-index.
  document.addEventListener(
    "pointerdown",
    (event) => {
      const trigger = resolveConfigureTriggerFromEvent(event);
      if (!trigger || trigger.getAttribute("aria-busy") === "true") return;
      protectConfigureTrigger(trigger);
    },
    true,
  );

  document.addEventListener(
    "click",
    (event) => {
      const trigger = resolveConfigureTriggerFromEvent(event);
      if (!trigger) return;

      handleConfigureClick(trigger, event);
    },
    true,
  );
}

/**
 * Install delegated "intent" listeners (hover, touch, keyboard focus) that warm the full catalog
 * BEFORE the shopper actually clicks — so by the time a deliberate click lands, the data is
 * usually already there and the modal opens instantly, same as before the split-phase fetch. A
 * click with no prior intent signal (e.g. a very fast tap) still works via openConfigurator's own
 * fallback fetch; this is purely a head start, never required for correctness. Bound at most once.
 */
function initConfigurePrefetchDelegation() {
  if (document.documentElement.dataset.protoPrefetchDelegated) return;
  document.documentElement.dataset.protoPrefetchDelegated = "true";

  const handler = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const trigger = target.closest<HTMLElement>("[data-proto-configurator-trigger]");
    if (!trigger || !isConfigureTriggerVisible(trigger)) return;
    const productId =
      trigger.dataset.productId ?? window.ProtoConfiguratorSettings?.productId ?? "";
    if (!productId) return;
    // Start both catalog + modal on intent — parse/execute the modal (not just download) so a
    // click that follows within a second doesn't wait on React startup.
    prefetchFullCatalog(productId);
    void loadModal().catch(() => {});
  };

  // pointerover covers mouse hover (desktop); touchstart covers touch devices (fires just ahead
  // of click, a short but real head start); focusin covers keyboard navigation (Tab to button).
  document.addEventListener("pointerover", handler, true);
  document.addEventListener("touchstart", handler, { capture: true, passive: true });
  document.addEventListener("focusin", handler, true);
}

/** Mark all existing trigger buttons as bound (a simple presence flag; clicks use delegation). */
function initButtons() {
  document.querySelectorAll("[data-proto-configurator-trigger]").forEach((el) => {
    (el as HTMLElement).dataset.protoBound = "true";
    protectConfigureTrigger(el as HTMLElement);
  });
  watchConfigureTriggersForThemeInterference();
}

/**
 * Theme product JS + Sticky ATC apps treat `.single-add-to-cart-button` as the real cart CTA:
 * they disable it and rewrite the label to "Sold out" when the selected variant is unavailable.
 * Our Configure button used to share that class for styling, so shoppers saw a dead "Sold out"
 * Configure control. Strip those classes, undo sold-out mutations, and restore the label —
 * except while we ourselves have the button in a loading state (aria-busy).
 *
 * IMPORTANT: only mutate when something is actually wrong. Blind classList/attribute writes feed
 * MutationObservers (ours or the theme's) and can freeze the PDP after refresh.
 */
let protectSuppressDepth = 0;
/** If a theme script fights our undo in a tight loop, stop observing that trigger. */
const triggerProtectHits = new WeakMap<HTMLElement, { windowStart: number; count: number }>();

function protectConfigureTrigger(trigger: HTMLElement) {
  if (protectSuppressDepth > 0) return;
  if (trigger.getAttribute("aria-busy") === "true") return;
  if (document.documentElement.hasAttribute("data-proto-configuring")) return;

  const stripClasses = [
    "single-add-to-cart-button",
    "product-form__submit",
    "add-to-cart",
  ] as const;
  const needsClassStrip = stripClasses.some((c) => trigger.classList.contains(c));
  const needsEnable =
    trigger.hasAttribute("disabled") || trigger.hasAttribute("aria-disabled");

  const expected =
    trigger.dataset.protoButtonLabel?.trim() ||
    trigger.getAttribute("data-proto-button-label")?.trim() ||
    "Configure";
  const label = trigger.querySelector(".proto-v2-label");
  let needsLabelFix = false;
  if (label) {
    const text = (label.textContent || "").trim();
    needsLabelFix = text !== expected && !/loading|adding/i.test(text);
  } else {
    needsLabelFix = /sold out/i.test((trigger.textContent || "").trim());
  }

  if (!needsClassStrip && !needsEnable && !needsLabelFix) return;

  const now = Date.now();
  let hits = triggerProtectHits.get(trigger);
  if (!hits || now - hits.windowStart > 1000) {
    hits = { windowStart: now, count: 0 };
    triggerProtectHits.set(trigger, hits);
  }
  hits.count += 1;
  const thrashing = hits.count > 12;

  protectSuppressDepth += 1;
  try {
    if (needsClassStrip) {
      trigger.classList.remove(...stripClasses);
    }
    if (trigger.hasAttribute("disabled")) {
      trigger.removeAttribute("disabled");
    }
    if (trigger.hasAttribute("aria-disabled")) {
      trigger.removeAttribute("aria-disabled");
    }
    if (needsLabelFix) {
      if (label) label.textContent = expected;
      else trigger.textContent = expected;
    }
  } finally {
    protectSuppressDepth -= 1;
  }

  if (thrashing) {
    // Theme is re-applying sold-out state every frame — stop observing (pointerdown still restores).
    const obs = triggerGuards.get(trigger);
    obs?.disconnect();
    triggerGuards.delete(trigger);
  }
}

/** Per-trigger attribute observers — never watch the whole document for `class` (theme PDPs
 *  toggle classes constantly; a document-wide observer stalls the main thread after load). */
const triggerGuards = new WeakMap<HTMLElement, MutationObserver>();
let triggerDiscoveryGuard: MutationObserver | null = null;

function watchOneConfigureTrigger(trigger: HTMLElement) {
  if (typeof MutationObserver === "undefined") return;
  if (triggerGuards.has(trigger)) return;

  let queued = false;
  const obs = new MutationObserver(() => {
    if (protectSuppressDepth > 0 || queued) return;
    queued = true;
    window.requestAnimationFrame(() => {
      queued = false;
      protectConfigureTrigger(trigger);
    });
  });
  obs.observe(trigger, {
    attributes: true,
    attributeFilter: ["disabled", "aria-disabled", "class"],
    // Label text lives in a child; watch subtree childList only (not characterData — too noisy).
    childList: true,
    subtree: true,
  });
  triggerGuards.set(trigger, obs);
}

function watchConfigureTriggersForThemeInterference() {
  document
    .querySelectorAll<HTMLElement>("[data-proto-configurator-trigger]")
    .forEach((el) => {
      protectConfigureTrigger(el);
      watchOneConfigureTrigger(el);
    });

  if (triggerDiscoveryGuard || typeof MutationObserver === "undefined") return;
  // childList-only: pick up triggers the theme (re)injects. No attributes — see comment above.
  let queued = false;
  triggerDiscoveryGuard = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    window.requestAnimationFrame(() => {
      queued = false;
      document
        .querySelectorAll<HTMLElement>("[data-proto-configurator-trigger]")
        .forEach((el) => {
          if (!triggerGuards.has(el)) {
            protectConfigureTrigger(el);
            watchOneConfigureTrigger(el);
          }
        });
    });
  });
  triggerDiscoveryGuard.observe(document.documentElement, {
    childList: true,
    subtree: true,
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
 * the param is absent or the fetch fails. Unaffected by the split-phase fetch — a share link is
 * an explicit request to view a specific configuration right now, so it always fetches the full
 * payload directly (there's no linkage decision to make first).
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

/** Run a low-priority task during browser idle time, falling back to a short timeout. */
function whenIdle(fn: () => void): void {
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void) => void })
    .requestIdleCallback;
  if (typeof ric === "function") ric(fn);
  else window.setTimeout(fn, 1200);
}

/**
 * Run a task only AFTER the page has fully loaded (window `load`), then during idle time.
 *
 * Why `load` matters and idle alone is not enough: requestIdleCallback fires on CPU idleness, not
 * network idleness — on a network-bound page load the main thread goes quiet early, so an "idle"
 * callback can start downloads that compete with the page's own images for bandwidth. And Safari
 * has no requestIdleCallback at all, so whenIdle's fallback is a flat 1.2s timer — on a slow
 * mobile connection that is squarely MID page load. Every automatic background warm-up (modal
 * bundle + full catalog) goes through THIS, so it can never race the page's own resources; real
 * shopper-intent signals (hover/touch/focus/click) still warm immediately, bypassing this wait.
 */
function afterLoadIdle(fn: () => void): void {
  if (document.readyState === "complete") {
    whenIdle(fn);
    return;
  }
  window.addEventListener("load", () => whenIdle(fn), { once: true });
}

let modalPrefetched = false;
/**
 * On a LINKED product page, warm the heavy modal bundle (~184KB of React + UI) during browser idle
 * with a low-priority `<link rel=prefetch>` — download only, no execution. The first Configure
 * click then loads it from cache and opens instantly instead of waiting on a cold download+parse
 * over mobile. Costs nothing on non-linked pages (never called) and nothing extra on repeat views
 * (the browser cache + this guard make it a no-op). Prefetch, not preload: we don't pay parse cost
 * for shoppers who never click.
 */
function prefetchModalBundle(): void {
  if (modalPrefetched || window.ProtoConfiguratorModal || modalLoadPromise) return;
  const url = getModalUrl();
  if (!url) return;
  modalPrefetched = true;
  try {
    const link = document.createElement("link");
    link.rel = "prefetch";
    link.as = "script";
    link.href = url;
    document.head.appendChild(link);
  } catch {
    // best-effort — a failed prefetch just means the click pays the normal load
  }
}

/**
 * Everything worth warming up once a page is confirmed linked: the modal JS bundle and the full
 * catalog. Both are pure background head-starts — a click still works correctly (just slower)
 * if either hasn't finished, or failed, by the time it happens.
 */
function warmUpForLikelyClick(productId: string): void {
  prefetchModalBundle();
  // Normal priority: first Configure click depends on this finishing. Low-priority was getting
  // starved behind theme images on the PDP and left the click path cold.
  prefetchFullCatalog(productId, false);
}

/**
 * Apply the full "linked" UI state. `configurator`, when already known (e.g. a full-catalog cache
 * hit from an earlier click this session), is cached immediately; when linkage was confirmed via
 * the lightweight link-only check, this is called with no configurator yet — the full catalog is
 * fetched separately (see warmUpForLikelyClick / openConfigurator).
 */
function applyLinkedUi(productId: string, configurator?: StorefrontConfigurator) {
  if (configurator) configuratorCache.set(productId, configurator);
  markProductLinked();
  // Catalog via App Proxy is ~250KB and often 5–10s — start soon after linkage so Configure is
  // warm before the shopper clicks. A short delay keeps this off the first-paint critical path
  // (which previously made the PDP feel frozen) without waiting for full `window.load`.
  window.setTimeout(() => warmUpForLikelyClick(productId), 400);
  // After load + idle, parse the React modal bundle so the first click isn't paying JS startup.
  afterLoadIdle(() => {
    void loadModal().catch(() => {});
  });

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
 * Silently refresh a cache-served FULL catalog from the proxy. Success updates both caches (so
 * prices/availability in the modal stay ≤ one page view stale). A DEFINITIVE negative answer
 * (code "not linked"/"inactive" — the merchant unassigned this racquet or turned the configurator
 * off) drops every cache (full + link) and hides the button. Transient failures (network/timeout,
 * no `code`) change nothing — the cached experience keeps working.
 */
async function revalidateConfigurator(productId: string) {
  const { configurator, code } = await fetchFullConfigurator(productId);
  if (configurator && configurator.theme.buttonEnabled !== false) {
    configuratorCache.set(productId, configurator);
    writeSessionCache(productId, configurator);
    writeLinkCache(productId, { linked: true });
    return;
  }
  if (code || (configurator && configurator.theme.buttonEnabled === false)) {
    configuratorCache.delete(productId);
    clearSessionCache(productId);
    clearLinkCache(productId);
    markProductUnlinked();
  }
}

/**
 * Silently re-check LINKAGE ONLY (not the full catalog) for a product whose button is showing
 * from a link-only cache hit (no full catalog fetched yet this view). Mirrors
 * revalidateConfigurator's semantics for the lightweight case: a definitive negative hides the
 * button and clears every cache; a transient failure changes nothing; a confirmed positive just
 * refreshes the cache timestamp.
 */
async function revalidateLinkage(productId: string) {
  const linkage = await fetchLinkage(productId);
  if (linkage.linked) {
    writeLinkCache(productId, { linked: true });
    return;
  }
  if (linkage.code) {
    writeLinkCache(productId, { linked: false, code: linkage.code });
    configuratorCache.delete(productId);
    clearSessionCache(productId);
    markProductUnlinked();
  }
  // transient failure (no code) — change nothing, cached "linked" experience keeps working
}

async function initStorefrontUi() {
  const productId = getPageProductId();
  if (!productId) {
    initButtons();
    return;
  }

  // Fastest path: the FULL catalog is already cached (e.g. the shopper opened the modal earlier
  // this session, or this is a shopify:section:load re-run on the same page) — strictly more
  // informed than the lightweight link cache, so use it directly and skip even the light fetch.
  const fullCached = configuratorCache.get(productId) ?? readSessionCache(productId);
  if (fullCached && fullCached.theme.buttonEnabled !== false) {
    applyLinkedUi(productId, fullCached);
    void revalidateConfigurator(productId);
    return;
  }

  // Common repeat-view path: a cached linkage-only answer from earlier this session. Positive →
  // show the button immediately (full catalog warms in the background); negative → hide with NO
  // round-trip at all — this is what makes repeat views of non-configured products free.
  const linkHit = readLinkCache(productId);
  if (linkHit) {
    if (linkHit.linked) {
      applyLinkedUi(productId);
      void revalidateLinkage(productId);
    } else {
      markProductUnlinked();
    }
    return;
  }

  // No cache at all — the split-phase fetch's page-load request: ~100 bytes to decide show/hide,
  // instead of the full catalog this used to cost on every single PDP view.
  markProductLinkagePending();
  const linkage = await fetchLinkage(productId);

  if (!linkage.linked) {
    // Theme Editor: linkage can't resolve here (the App Proxy doesn't run in the editor preview),
    // so a result with no code (a transient failure, not a real negative) is EXPECTED, not
    // "unlinked". Reveal the standalone button anyway so the merchant can see and position the
    // block; it gates normally on the live storefront where the proxy works. (Only the
    // self-contained v2 button — the legacy buy-box gate must never run in the editor.)
    if (!linkage.code && isThemeEditor() && isStandaloneV2Mode()) {
      markProductLinked();
      initV2StandaloneGate();
      initButtons();
      return;
    }
    if (linkage.code) {
      // Definitive negative (not_linked / inactive / button_disabled) — cache it so repeat views
      // of this product (very likely, for a non-configured product on a general store) cost
      // nothing.
      writeLinkCache(productId, { linked: false, code: linkage.code });
    }
    markProductUnlinked();
    return;
  }

  writeLinkCache(productId, { linked: true });
  applyLinkedUi(productId);
}

/**
 * One-time startup: wire click/prefetch delegation + gate, run the linkage check, restore any
 * share. The React modal is NOT mounted here — it loads lazily on the first Configure click (or
 * immediately when a share link is present), keeping page-load JS tiny.
 */
function boot() {
  invalidateThemeBlockCache();
  initConfigureClickDelegation();
  initConfigurePrefetchDelegation();
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
