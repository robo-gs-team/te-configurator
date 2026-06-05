import { AnimatePresence, motion } from "framer-motion";
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
    ProtoConfiguratorSettings?: {
      appProxyUrl: string;
      productId: string;
    };
  }
}

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
  const getVariantId = useConfiguratorStore((s) => s.getVariantId);
  const stringingMode = useConfiguratorStore((s) => s.stringingMode);
  const standardBed = useConfiguratorStore((s) => s.standardBed);
  const hybridBeds = useConfiguratorStore((s) => s.hybridBeds);

  const theme = configurator?.theme;
  const isDark = theme?.modalTheme !== "light";
  const accent = theme?.modalAccent ?? "#6366f1";
  const appProxyUrl =
    window.ProtoConfiguratorSettings?.appProxyUrl ?? "/apps/proto-configurator";

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
      trackEvent(appProxyUrl, "modal_open", {
        configuratorId: configurator?.id,
        productId,
      });
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen, appProxyUrl, configurator?.id, productId]);

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
      trackEvent(appProxyUrl, "add_to_cart", {
        configuratorId: configurator.id,
        total: getPrice().total,
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
    stringingMode,
    standardBed,
    hybridBeds,
    close,
    setAddingToCart,
    setCartError,
    appProxyUrl,
  ]);

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
    <AnimatePresence mode="wait">
      <motion.div
        key="configurator-modal"
          className="fixed inset-0 flex items-center justify-center"
          style={{ zIndex: 2147483647 }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
        >
          <motion.div
            className="absolute inset-0"
            style={{
              backgroundColor: isDark ? "rgba(0,0,0,0.75)" : "rgba(0,0,0,0.5)",
              backdropFilter: `blur(${theme?.overlayBlur ?? 12}px)`,
            }}
            onClick={close}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />

          <motion.div
            className={`relative w-full overflow-hidden flex flex-col ${
              isStringing
                ? "h-full md:h-auto md:max-h-[92vh] md:max-w-[960px] md:mx-4 md:rounded-[10px] bg-white shadow-2xl"
                : `h-full md:h-[92vh] md:max-w-6xl md:mx-4 md:rounded-3xl ${isDark ? "bg-neutral-950" : "bg-neutral-50"}`
            }`}
            initial={{ opacity: 0, y: 40, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.98 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
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
                  <StringingConfigurator
                    onClose={close}
                    onAddToCart={handleAddToCart}
                    isAddingToCart={isAddingToCart}
                  />
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
                <motion.button
                  type="button"
                  onClick={handleAddToCart}
                  disabled={isAddingToCart}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="px-8 py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-60 shrink-0"
                  style={{ backgroundColor: accent }}
                >
                  {isAddingToCart ? "Adding..." : "Add to Cart"}
                </motion.button>
              </div>
            </footer>
            )}

            {cartError && (
              <div className="absolute bottom-20 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg bg-red-500/90 text-white text-sm">
                {cartError}
              </div>
            )}
          </motion.div>
        </motion.div>
    </AnimatePresence>
  );

  return createPortal(modal, document.body);
}
