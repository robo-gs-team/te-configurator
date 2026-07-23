import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";

/**
 * Scope EVERY rule in the storefront bundle to inside `#proto-configurator-root` (the modal mount
 * point), so nothing in the globally-loaded proto-configurator.css can restyle the merchant's
 * theme. Defined INLINE here (not via a separate postcss config file) because Vite treats a string
 * `css.postcss` as a directory to search — so an external storefront postcss config silently never
 * loaded. See tailwind.storefront.config.ts for why this is a prefix plugin and not Tailwind's
 * `important: "#selector"` strategy (the latter forces `!important` on every utility and butchered
 * the modal's hand-written design CSS).
 *
 * Left UNSCOPED (matched by EXCLUDE): selectors already containing `proto-configurator-root` (the
 * manual reset / root class rule — also makes this idempotent on re-visits) and the button-visibility
 * gate (`…proto-configurator-button-wrapper`), which targets the page, not the modal. Keyframe step
 * selectors (from/to/%) are skipped — prefixing them is invalid.
 */
// Channel suffix for the Stable/Beta release-channel system (see configurator-embed.liquid). The
// default (stable) build writes `proto-configurator.js/css`; `PROTO_CHANNEL=beta` writes
// `proto-configurator.beta.js/css`. The app embed loads one or the other per theme, so the live
// theme can stay pinned to the frozen stable bundle while a draft theme runs the latest beta.
const CHANNEL_SUFFIX = process.env.PROTO_CHANNEL === "beta" ? ".beta" : "";

const EXCLUDE = /proto-configurator-root|proto-configurator-button-wrapper/;
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

/**
 * Convert every `rem` length in the bundle to a fixed `px` (16px base).
 *
 * WHY THIS EXISTS — a live production bug: our modal's Tailwind utilities are rem-based, and `rem`
 * ALWAYS resolves against the host document's <html> font-size, which our `#proto-configurator-root`
 * scoping physically cannot override (rem is root-relative by definition). Several merchant themes
 * set a non-16px root font-size (e.g. `html{font-size:62.5%}` → 10px, or a larger value), which
 * silently rescaled the ENTIRE modal — oversized type, cramped spacing, the fixed-width (px) panel
 * overflowing its own content and cutting off the Add-to-Cart button. It renders perfectly in
 * isolation (16px root) and breaks only on the merchant's store, which is exactly why it was so
 * hard to pin down.
 *
 * Pinning `font-size` on the modal root does NOT help — rem ignores it. The only reliable fix is to
 * stop depending on the host root entirely: bake every rem down to the px it was designed against.
 * The hand-written `.proto-desk-*` CSS is already px, so this only touches the Tailwind utilities,
 * locking the modal to its intended 16px-based scale on ANY theme. Browser zoom still scales px, so
 * user zoom-based accessibility is preserved; only the theme's arbitrary root font-size is
 * neutralized. Runs storefront-bundle-only — the admin app and the merchant's theme are untouched.
 */
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

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "~/lib": resolve(__dirname, "app/lib"),
    },
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    outDir: "build/storefront",
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, "storefront/entry.tsx"),
      name: "ProtoConfigurator",
      formats: ["iife"],
      fileName: () => `proto-configurator${CHANNEL_SUFFIX}.js`,
    },
    rollupOptions: {
      output: {
        assetFileNames: `proto-configurator${CHANNEL_SUFFIX}.[ext]`,
        inlineDynamicImports: true,
      },
    },
    cssCodeSplit: false,
    minify: "esbuild",
    sourcemap: false,
  },
  css: {
    // Inline plugin list so it actually runs (a string path here is treated as a search dir).
    // Tailwind uses the storefront-scoped config (also pinned via @config in storefront/styles.css);
    // scopeToModalRoot then prefixes every rule to #proto-configurator-root; autoprefixer last.
    postcss: {
      plugins: [
        tailwindcss({ config: "./tailwind.storefront.config.ts" }),
        scopeToModalRoot,
        remToPx,
        autoprefixer(),
      ],
    },
  },
});
