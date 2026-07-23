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
        autoprefixer(),
      ],
    },
  },
});
