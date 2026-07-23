import { useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { LivePreview } from "./LivePreview";
import { AddonsStep, VariantStep } from "./Steps";
import { StringingConfigurator } from "./StringingConfigurator";
import { usesStringingUi } from "../lib/string-catalog";
import { useConfiguratorStore } from "../store/configurator-store";
import {
  addToShopifyCart,
  saveConfiguration,
  trackEvent,
} from "../lib/cart";

declare global {
  interface Window {
    // Must stay identical to the declaration in storefront/entry.tsx (TS requires duplicate
    // global declarations to agree exactly).
    ProtoConfiguratorSettings?: {
      appProxyUrl: string;
      productId: string;
      shopDomain?: string;
      channel?: string;
      modalUrl?: string;
    };
  }
}

/**
 * ConfiguratorModal — the full-screen pop-up the shopper sees after clicking Configure.
 *
 * Renders as a React portal on <body> (top of the stacking order) with a blurred backdrop.
 * It reads all state from the Zustand store and renders one of two bodies:
 *   - StringingConfigurator (the tennis stringing flow) when the configurator uses the
 *     stringing UI (i.e. it has a labor variant), or
 *   - the generic VariantStep + AddonsStep flow otherwise.
 *
 * Returns null when closed (or before a configurator is loaded), so it costs nothing until
 * opened. Hosts the add-to-cart and share handlers, and the background scroll-lock effect.
 */
export function ConfiguratorModal() {
  const isOpen = useConfiguratorStore((s) => s.isOpen);
  const close = useConfiguratorStore((s) => s.close);
  const configurator = useConfiguratorStore((s) => s.configurator);
  const productId = useConfiguratorStore((s) => s.productId);
  const selections = useConfiguratorStore((s) => s.selections);
  const addonSelections = useConfiguratorStore((s) => s.addonSelections);
  const isAddingToCart = useConfiguratorStore((s) => s.isAddingToCart);
  const cartError = useConfiguratorStore((s) => s.cartError);
  const shareUrl = useConfiguratorStore((s) => s.shareUrl);
  const setAddingToCart = useConfiguratorStore((s) => s.setAddingToCart);
  const setCartError = useConfiguratorStore((s) => s.setCartError);
  const setShareUrl = useConfiguratorStore((s) => s.setShareUrl);
  const getPrice = useConfiguratorStore((s) => s.getPrice);
  const getStringingTotal = useConfiguratorStore((s) => s.getStringingTotal);
  const getVariantId = useConfiguratorStore((s) => s.getVariantId);
  const stringingMode = useConfiguratorStore((s) => s.stringingMode);
  const standardBed = useConfiguratorStore((s) => s.standardBed);
  const hybridBeds = useConfiguratorStore((s) => s.hybridBeds);

  const theme = configurator?.theme;
  const isDark = theme?.modalTheme !== "light";
  const accent = theme?.modalAccent ?? "#6366f1";
  const appProxyUrl =
    window.ProtoConfiguratorSettings?.appProxyUrl ?? "/apps/proto-configurator";

  // Scroll-lock the background page while the modal is open, and emit modal_open once.
  // Uses the position:fixed + saved-scrollY technique (plain overflow:hidden fails on iOS
  // Safari); the saved position is restored on close/unmount.
  useEffect(() => {
    if (isOpen) {
      // Use position:fixed technique so iOS Safari doesn't scroll the background
      const scrollY = window.scrollY;
      document.body.style.position = "fixed";
      document.body.style.top = `-${scrollY}px`;
      document.body.style.width = "100%";
      document.body.style.overflow = "hidden";
      trackEvent(appProxyUrl, "modal_open", {
        configuratorId: configurator?.id,
        productId,
      });
    } else {
      const top = document.body.style.top;
      document.body.style.position = "";
      document.body.style.top = "";
      document.body.style.width = "";
      document.body.style.overflow = "";
      if (top) window.scrollTo(0, -parseInt(top, 10));
    }
    return () => {
      const top = document.body.style.top;
      document.body.style.position = "";
      document.body.style.top = "";
      document.body.style.width = "";
      document.body.style.overflow = "";
      if (top) window.scrollTo(0, -parseInt(top, 10));
    };
  }, [isOpen, appProxyUrl, configurator?.id, productId]);

  // Build + submit the cart from current store state. On success: track add_to_cart and close
  // the modal. On failure: surface the error in the store (shown in the modal). Passes the
  // stringing bed selections only when the stringing UI is active.
  const handleAddToCart = useCallback(async () => {
    if (!configurator || !productId) return;
    setAddingToCart(true);
    setCartError(null);

    const result = await addToShopifyCart(
      configurator,
      selections,
      addonSelections,
      getVariantId(),
      productId,
      1,
      usesStringingUi(configurator)
        ? { mode: stringingMode, standardBed, hybridBeds }
        : undefined,
    );

    setAddingToCart(false);

    if (result.success) {
      const isStringing = usesStringingUi(configurator);
      trackEvent(appProxyUrl, "add_to_cart", {
        configuratorId: configurator.id,
        productId,
        mode: isStringing ? stringingMode : "generic",
        // Revenue added to cart. The orders/create webhook records the real purchased revenue;
        // this is the top-of-funnel "added" figure.
        value: isStringing ? getStringingTotal() : getPrice().total,
      });
      close();
    } else {
      setCartError(result.error ?? "Failed to add to cart");
    }
  }, [
    configurator,
    productId,
    selections,
    addonSelections,
    getVariantId,
    getPrice,
    getStringingTotal,
    stringingMode,
    standardBed,
    hybridBeds,
    close,
    setAddingToCart,
    setCartError,
    appProxyUrl,
  ]);

  // Save the current configuration via the proxy, copy the returned share URL to the
  // clipboard, and track a share event. (Reachable only from the generic flow's footer.)
  const handleShare = useCallback(async () => {
    if (!configurator || !productId) return;
    const url = await saveConfiguration(appProxyUrl, {
      configuratorId: configurator.id,
      productId,
      selections,
      addons: addonSelections,
      totalPrice: getPrice().total,
    });
    if (url) {
      setShareUrl(url);
      navigator.clipboard?.writeText(url);
      trackEvent(appProxyUrl, "share", { configuratorId: configurator.id });
    }
  }, [
    configurator,
    productId,
    selections,
    addonSelections,
    getPrice,
    setShareUrl,
    appProxyUrl,
  ]);

  const hasAddons = (configurator?.addons.length ?? 0) > 0;
  const isStringing = usesStringingUi(configurator);
  if (!isOpen || !configurator) {
    return null;
  }

  const modal = (
      <div
          className="fixed inset-0 flex items-center justify-center proto-anim-fade"
          style={{ zIndex: 2147483647 }}
        >
          <div
            className="absolute inset-0 proto-anim-fade"
            style={{
              backgroundColor: isDark ? "rgba(0,0,0,0.75)" : "rgba(0,0,0,0.5)",
              backdropFilter: `blur(${theme?.overlayBlur ?? 12}px)`,
            }}
            onClick={close}
          />

          <div
            className={`relative w-full overflow-hidden flex flex-col proto-anim-panel ${
              isStringing
                ? "h-full md:h-auto md:max-h-[92vh] md:max-w-[960px] md:mx-4 md:rounded-[10px] bg-white shadow-2xl"
                : `h-full md:h-[92vh] md:max-w-6xl md:mx-4 md:rounded-3xl ${isDark ? "bg-neutral-950" : "bg-neutral-50"}`
            }`}
            role="dialog"
            aria-modal="true"
            aria-label={configurator.name}
          >
            {!isStringing && (
              <header className="flex items-center justify-between px-6 py-4 border-b border-white/10">
                <div>
                  <h2 className={`text-xl font-bold ${isDark ? "text-white" : "text-neutral-900"}`}>
                    {configurator.name}
                  </h2>
                  {configurator.description && (
                    <p className={`text-sm mt-0.5 ${isDark ? "text-white/50" : "text-neutral-500"}`}>
                      {configurator.description}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={close}
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                    isDark ? "bg-white/10 hover:bg-white/20 text-white" : "bg-black/5 hover:bg-black/10"
                  }`}
                  aria-label="Close"
                >
                  ✕
                </button>
              </header>
            )}

            <div className={`flex-1 overflow-hidden flex flex-col ${isStringing ? "min-h-0" : "md:flex-row"}`}>
              {!isStringing && (
                <div className="flex md:w-1/2 items-center justify-center p-6 md:p-8 bg-black/20 border-b md:border-b-0 md:border-r border-white/10">
                  <LivePreview />
                </div>
              )}
              <div
                className={`flex-1 min-h-0 ${isStringing ? "flex flex-col" : "overflow-y-auto p-6 proto-scrollbar space-y-8"}`}
              >
                {isStringing ? (
                  <>
                    <StringingConfigurator
                      onClose={close}
                      onAddToCart={handleAddToCart}
                      isAddingToCart={isAddingToCart}
                    />
                    {hasAddons && (
                      <div className="px-6 pb-6 border-t border-neutral-200">
                        <h3 className="text-lg font-semibold mb-4 text-neutral-900">
                          Add-ons
                        </h3>
                        <AddonsStep />
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <VariantStep />
                    {hasAddons && (
                      <div>
                        <h3
                          className={`text-lg font-semibold mb-4 ${isDark ? "text-white" : "text-neutral-900"}`}
                        >
                          Add-ons
                        </h3>
                        <AddonsStep />
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {!isStringing && (
            <footer className="px-6 py-4 flex items-center justify-between gap-4 border-t border-white/10">
              <button
                type="button"
                onClick={handleShare}
                className={`px-5 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  isDark
                    ? "text-white/70 hover:text-white hover:bg-white/10"
                    : "text-neutral-600 hover:text-neutral-900 hover:bg-black/5"
                }`}
                title="Copy share link"
              >
                {shareUrl ? "Link copied!" : "Share"}
              </button>

              <div className="flex items-center gap-4 flex-1 justify-end min-w-0">
                <span
                  className={`font-semibold hidden sm:block shrink-0 ${isDark ? "text-white" : "text-neutral-900"}`}
                >
                  ${getPrice().total.toFixed(2)}
                </span>
                <button
                  type="button"
                  onClick={handleAddToCart}
                  disabled={isAddingToCart}
                  className="proto-press px-8 py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-60 shrink-0"
                  style={{ backgroundColor: accent }}
                >
                  {isAddingToCart ? "Adding..." : "Add to Cart"}
                </button>
              </div>
            </footer>
            )}

            {/* Stringing flow renders its own cartError inside StringingConfigurator, so only
                show this one for the generic flow — otherwise a stringing error appears twice. */}
            {cartError && !isStringing && (
              <div className="absolute bottom-20 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg bg-red-500/90 text-white text-sm">
                {cartError}
              </div>
            )}
          </div>
        </div>
  );

  // Portal INTO #proto-configurator-root (not <body>) so the modal stays a descendant of the
  // element the storefront Tailwind build scopes every utility class to (important:
  // "#proto-configurator-root"). Portaling to <body> put the modal OUTSIDE that scope, so none of
  // its layout classes (fixed/inset-0/flex/…) matched and it opened invisibly. The root element is
  // created (by modal-entry.tsx#mount) with position:relative + max z-index before this renders;
  // position:relative does NOT create a containing block for the modal's position:fixed, so it
  // still covers the viewport. Fallback to <body> only if the root is somehow absent.
  const portalTarget =
    document.getElementById("proto-configurator-root") ?? document.body;
  return createPortal(modal, portalTarget);
}
