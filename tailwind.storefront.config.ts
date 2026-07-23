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
 * This config (pinned via the @config directive in storefront/styles.css and passed to the
 * tailwindcss plugin inline in vite.storefront.config.ts) ensures the storefront build only ever
 * sees classes actually used in storefront/**, so nothing from the admin app can leak into the
 * public bundle again, regardless of what the admin UI adds.
 *
 * Content-scoping alone does NOT fully fix the live incident, though: `grid` is genuinely used by
 * our OWN modal UI (storefront/components/Steps.tsx), and Tailwind utility class names are bare
 * (`.grid`, `.flex`, ...) with no relation to which app "owns" them — since proto-configurator.css
 * is loaded globally on every storefront page via a plain <link>, our `.grid{display:grid}` was
 * matching the MERCHANT'S OWN unrelated `.grid` elements (their collection-page product grid),
 * clobbering it.
 *
 * Scoping is therefore done by a small PostCSS plugin inline in vite.storefront.config.ts that
 * prefixes EVERY rule in this bundle with `#proto-configurator-root ` (so `.grid` -> `#proto-configurator-root
 * .grid`, matching only inside the modal mount point, never the merchant's page). We deliberately
 * do NOT use Tailwind's `important: "#selector"` strategy for this: that scopes utilities but also
 * flags every one `!important`, which then overrode the modal's own hand-written `.proto-desk-*`
 * design CSS (backgrounds/spacing/borders) that is supposed to win by source order — butchering
 * the modal's look. The prefix plugin scopes utilities AND the design rules equally, preserving
 * their original relative specificity + source order, with no `!important` anywhere.
 */
export default {
  content: ["./storefront/**/*.{js,jsx,ts,tsx}"],
  // Preflight stays OFF: its global `*, ::before, ::after` reset (border-width:0, margin/box-sizing
  // resets, html/body font + line-height) would apply to the WHOLE storefront via the
  // globally-loaded proto-configurator.css and clobber the theme site-wide. The modal gets an
  // equivalent reset scoped to #proto-configurator-root in storefront/styles.css instead.
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
