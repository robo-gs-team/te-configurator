import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

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
      fileName: () => "proto-configurator.js",
    },
    rollupOptions: {
      output: {
        assetFileNames: "proto-configurator.[ext]",
        inlineDynamicImports: true,
      },
    },
    cssCodeSplit: false,
    minify: "esbuild",
    sourcemap: false,
  },
  css: {
    // The storefront Tailwind scoping (storefront/** content, Preflight OFF, utilities scoped to
    // #proto-configurator-root) is bound via the `@config` directive at the top of
    // storefront/styles.css — which Tailwind honors over this postcss config — so the standard
    // root postcss.config.js is fine here. See tailwind.storefront.config.ts for the full why.
    postcss: "./postcss.config.js",
  },
});
