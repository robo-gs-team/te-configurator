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
    postcss: "./postcss.config.js",
  },
});
