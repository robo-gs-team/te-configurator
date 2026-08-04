import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";

/**
 * The ONE PostCSS pipeline for all storefront CSS, shared by vite.storefront.config.ts (the tiny
 * entry stylesheet) and vite.storefront-modal.config.ts (the modal styles, now bundled INTO the
 * lazy modal JS via `styles.css?inline` — see modal-entry.tsx).
 *
 * It must be shared: when the modal config processed CSS through the app's default
 * postcss.config.js instead, the modal styles would have skipped BOTH safety transforms below and
 * silently lost their theme isolation. Keeping the plugins in one module makes that impossible.
 *
 * scopeToModalRoot — prefix every rule with `#proto-configurator-root` so nothing in our CSS can
 * restyle the merchant's theme. Selectors already mentioning proto-configurator-root, and the
 * page-level button-visibility gate (proto-configurator-button-wrapper), are left unscoped.
 * Keyframe step selectors (from/to/%) are skipped — prefixing them is invalid.
 *
 * remToPx — bake every rem to px (16px base). rem resolves against the HOST page's <html>
 * font-size, which scoping cannot override; themes with a non-16px root (62.5% is common) silently
 * rescaled the whole modal. Browser zoom still scales px, so user zoom accessibility is preserved.
 */
// Unscoped: the modal root's own rules, and the PAGE-level rules (button visibility gate + the
// inline buy-box layout classes) that target the merchant's page, not the modal subtree.
const EXCLUDE =
  /proto-configurator-root|proto-configurator-button-wrapper|proto-configurator-actions--inline|proto-v2-inline-slot|proto-v2-standalone-wrapper|data-proto-v2-atc-slot|data-proto-buy-buttons-suppressed/;
const scopeToModalRoot = {
  postcssPlugin: "proto-scope-to-modal-root",
  Rule(rule: { parent?: { type?: string; name?: string }; selectors: string[] }) {
    const parent = rule.parent;
    if (parent && parent.type === "atrule" && /keyframes$/i.test(parent.name ?? "")) return;
    rule.selectors = rule.selectors.map((selector) =>
      EXCLUDE.test(selector) ? selector : `#proto-configurator-root ${selector}`,
    );
  },
};

const REM_BASE_PX = 16;
const remToPx = {
  postcssPlugin: "proto-rem-to-px",
  Declaration(decl: { value: string }) {
    if (!decl.value.includes("rem")) return;
    decl.value = decl.value.replace(
      /(-?\d*\.?\d+)rem\b/g,
      (_m: string, n: string) => `${parseFloat(n) * REM_BASE_PX}px`,
    );
  },
};

export const storefrontPostcssPlugins = [
  tailwindcss({ config: "./tailwind.storefront.config.ts" }),
  scopeToModalRoot,
  remToPx,
  autoprefixer(),
];
