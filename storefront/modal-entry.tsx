import { createRoot, type Root } from "react-dom/client";
import { ConfiguratorErrorBoundary } from "./components/ConfiguratorErrorBoundary";
import { ConfiguratorModal } from "./components/ConfiguratorModal";
import { useConfiguratorStore } from "./store/configurator-store";
import { collectImageUrls, preloadImages } from "./lib/image-preloader";
import type { StorefrontConfigurator } from "~/lib/configurator.types";

/**
 * modal-entry.tsx — the heavy, lazy-loaded half of the storefront bundle.
 *
 * This is built as a SEPARATE IIFE (proto-configurator-modal.js) and is NOT loaded on page
 * load. The tiny entry bundle (entry.tsx) injects a <script> for this file the first time a
 * shopper actually clicks Configure (or opens a share link). It carries React, the Zustand
 * store, the full modal component tree, and the image preloader — everything a shopper who
 * never engages should never have to download.
 *
 * It exposes its API on window.ProtoConfiguratorModal so the entry bundle can drive it.
 */

export interface ProtoConfiguratorModalApi {
  open: (productId: string, configurator: StorefrontConfigurator) => void;
  close: () => void;
  restoreShare: (
    productId: string,
    configurator: StorefrontConfigurator,
    selections?: Record<string, string>,
    addons?: Record<string, number>,
  ) => void;
}

declare global {
  interface Window {
    ProtoConfiguratorModal?: ProtoConfiguratorModalApi;
  }
}

/** The single React root hosting the modal; created once on first mount. */
let reactRoot: Root | null = null;

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
    reactRoot.render(<App />);
  }
}

function open(productId: string, configurator: StorefrontConfigurator) {
  mount();
  useConfiguratorStore.getState().open(productId, configurator);
  void preloadImages(collectImageUrls(configurator)).catch(() => {});
}

function close() {
  useConfiguratorStore.getState().close();
}

function restoreShare(
  productId: string,
  configurator: StorefrontConfigurator,
  selections?: Record<string, string>,
  addons?: Record<string, number>,
) {
  mount();
  const store = useConfiguratorStore.getState();
  store.open(productId, configurator);
  if (selections && addons) {
    store.restoreFromShare(selections, addons);
  }
  void preloadImages(collectImageUrls(configurator)).catch(() => {});
}

// Assign in the module body so it survives regardless of the IIFE's return value.
window.ProtoConfiguratorModal = { open, close, restoreShare };
