import type { Config } from "tailwindcss";

/**
 * Storefront-only Tailwind config.
 *
 * `content` is scoped EXCLUSIVELY to `storefront/**` — this is the root cause fix for a live
 * production bug: the shared root `tailwind.config.ts` scans both `app/**` (admin) and
 * `storefront/**`, so Tailwind's generated utility set reflects classes used ANYWHERE across
 * both, and that entire set gets emitted wherever `@tailwind utilities` appears. Since
 * `storefront/styles.css` has `@tailwind utilities` and is bundled into `proto-configurator.css`
 * (loaded globally on every storefront page via the app embed), any utility class that happened
 * to be used only in an ADMIN route (e.g. a Tailwind `grid` class in an admin dashboard layout)
 * was leaking straight into the merchant's live storefront CSS — in this case `.grid{display:grid}`
 * collided with the theme's own semantic `.grid` class and broke collection-page layouts
 * storefront-wide.
 *
 * This config (wired in via postcss.storefront.config.js -> vite.storefront.config.ts) ensures
 * the storefront build only ever sees classes actually used in storefront/**, so nothing from
 * the admin app can leak into the public bundle again, regardless of what the admin UI adds.
 *
 * Content-scoping alone does NOT fully fix the live incident, though: `grid` is genuinely used by
 * our OWN modal UI (storefront/components/Steps.tsx), and Tailwind utility class names are bare
 * (`.grid`, `.flex`, ...) with no relation to which app "owns" them — since proto-configurator.css
 * is loaded globally on every storefront page via a plain <link>, our `.grid{display:grid}` was
 * matching the MERCHANT'S OWN unrelated `.grid` elements (their collection-page product grid),
 * clobbering it. `important` set to a selector (Tailwind's "Selector Strategy") scopes every
 * generated utility to only apply inside that ancestor, so `.grid` compiles to
 * `#proto-configurator-root .grid{display:grid!important}` — matching only inside the dynamically
 * created React modal mount point (see modal-entry.tsx#ensureRoot), never the merchant's page.
 */
export default {
  content: ["./storefront/**/*.{js,jsx,ts,tsx}"],
  // `important` scopes generated UTILITIES to only apply inside the modal root (so `.grid`,
  // `.flex`, etc. can never touch the merchant's page). But it does NOT scope Preflight — so we
  // also disable Preflight entirely: its global `*, ::before, ::after` reset (border-width:0,
  // margin/box-sizing resets, html/body font + line-height) was applying to the WHOLE storefront
  // via the globally-loaded proto-configurator.css and clobbering the theme site-wide. The modal
  // gets an equivalent reset scoped to #proto-configurator-root in storefront/styles.css instead.
  important: "#proto-configurator-root",
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
      },
      animation: {
        "fade-in": "fadeIn 0.3s ease-out",
        "slide-up": "slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(20px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      backdropBlur: {
        xs: "2px",
      },
    },
  },
  plugins: [],
} satisfies Config;
