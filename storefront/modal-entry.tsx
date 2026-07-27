import { createRoot, type Root } from "react-dom/client";
import { ConfiguratorErrorBoundary } from "./components/ConfiguratorErrorBoundary";
import { ConfiguratorModal } from "./components/ConfiguratorModal";
import { useConfiguratorStore } from "./store/configurator-store";
import type { StorefrontConfigurator } from "~/lib/configurator.types";
// The FULL modal stylesheet, bundled into this lazy JS as a string (`?inline` — runs through the
// same scoped/rem-to-px PostCSS pipeline as before, see vite.storefront-postcss.ts) and injected
// as a <style> on mount. This is what took ~33KB of render-blocking, modal-only CSS off every
// racquet PDP's initial load: the page now ships only the tiny entry.css, and these styles arrive
// with the modal itself — always present before first render, since injection precedes mounting.
import modalStyles from "./styles.css?inline";

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

/** Inject the modal stylesheet once, idempotently, before anything renders. */
function ensureStyles() {
  if (document.getElementById("proto-configurator-modal-styles")) return;
  const style = document.createElement("style");
  style.id = "proto-configurator-modal-styles";
  style.textContent = modalStyles;
  document.head.appendChild(style);
}

/** Ensure the `#proto-configurator-root` element exists on <body> and render the App into it. */
function mount() {
  ensureStyles();
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
  // NOTE: we deliberately do NOT preload every catalog image here. That fired a download for the
  // full-resolution photo of every string in the catalog the instant the modal opened — dozens of
  // parallel requests (potentially many MB on mobile) competing with the modal's own first paint.
  // The string cards render each thumbnail with loading="lazy" + a placeholder, so images arrive
  // as the shopper scrolls, on demand, instead of all at once up front.
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
  // See open(): no bulk image preload — cards lazy-load their own thumbnails.
}

// Assign in the module body so it survives regardless of the IIFE's return value.
window.ProtoConfiguratorModal = { open, close, restoreShare };
