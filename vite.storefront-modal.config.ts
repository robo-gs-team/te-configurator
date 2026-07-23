import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

// Builds the heavy, lazy-loaded modal bundle (React + store + modal UI) as a standalone
// IIFE. The tiny entry bundle (vite.storefront.config.ts) injects this on first interaction.
// The IIFE global name is intentionally different from the runtime window.ProtoConfiguratorModal
// the module assigns, so the IIFE's return value can't clobber the API object.
//
// `PROTO_CHANNEL=beta` writes `proto-configurator-modal.beta.js` for the Stable/Beta release
// channel (see configurator-embed.liquid). The entry bundle loads whichever modal URL the embed
// passes via window.ProtoConfiguratorSettings.modalUrl, so it's channel-agnostic itself.
const CHANNEL_SUFFIX = process.env.PROTO_CHANNEL === "beta" ? ".beta" : "";

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
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, "storefront/modal-entry.tsx"),
      name: "ProtoConfiguratorModalBundle",
      formats: ["iife"],
      fileName: () => `proto-configurator-modal${CHANNEL_SUFFIX}.js`,
    },
    rollupOptions: {
      output: {
        assetFileNames: `proto-configurator-modal${CHANNEL_SUFFIX}.[ext]`,
        inlineDynamicImports: true,
      },
    },
    cssCodeSplit: false,
    minify: "esbuild",
    sourcemap: false,
  },
  css: {
    postcss: "./postcss.config.js",
  },
});
