import "@shopify/shopify-app-remix/adapters/vercel";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";

/**
 * Env vars the app cannot run without. Checked HERE, before shopifyApp() init, because
 * shopifyApp() throws at MODULE LOAD on empty config — and since Remix bundles every route into
 * one server file, that single throw used to kill the ENTIRE server (every admin route AND the
 * storefront App Proxy) with a blank "Application Error" and zero diagnostics. Verified locally:
 * unsetting SHOPIFY_APP_URL made the process refuse to boot at all.
 */
const REQUIRED_ENV = [
  "SHOPIFY_API_KEY",
  "SHOPIFY_API_SECRET",
  "SHOPIFY_APP_URL",
  "SCOPES",
] as const;

/** Names (never values) of required env vars missing in this runtime. Surfaced by /healthz. */
export const missingRequiredEnv: string[] = REQUIRED_ENV.filter(
  (key) => !process.env[key]?.trim(),
);

function buildShopify() {
  return shopifyApp({
    apiKey: process.env.SHOPIFY_API_KEY,
    apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
    apiVersion: ApiVersion.January25,
    scopes: process.env.SCOPES?.split(","),
    appUrl: process.env.SHOPIFY_APP_URL || "",
    authPathPrefix: "/auth",
    sessionStorage: new PrismaSessionStorage(prisma),
    distribution: AppDistribution.SingleMerchant,
    future: {
      unstable_newEmbeddedAuthStrategy: true,
      expiringOfflineAccessTokens: true,
    },
    ...(process.env.SHOP_CUSTOM_DOMAIN
      ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
      : {}),
  });
}

/** Set when Shopify config is broken; /healthz reports it. Null when everything is healthy. */
export let shopifyInitError: string | null = null;

/**
 * When config is broken we still let the server BOOT: routes that don't need Shopify (like
 * /healthz) keep working, and routes that do get a descriptive 503 instead of a dead process.
 * This proxy stands in for the real shopify object — any property access returns another proxy,
 * and any CALL throws a route-error-response-shaped object saying exactly what's wrong.
 *
 * Why that shape and not a Response/Error: a loader-thrown raw Response reaches ErrorBoundaries
 * as-is (isRouteErrorResponse false, body unreadable in a component), and a plain Error gets
 * sanitized to "Unexpected Server Error" in production. isRouteErrorResponse is duck-typed
 * (status + statusText + internal + data), and route error responses pass through Remix's
 * production sanitization with data intact — so this object renders readably in the boundaries
 * AND drives the correct 503 document status.
 */
function makeConfigErrorProxy(message: string): ReturnType<typeof buildShopify> {
  const throwResponse = (): never => {
    // eslint-disable-next-line @typescript-eslint/no-throw-literal
    throw {
      status: 503,
      statusText: "Server misconfigured",
      internal: false,
      data: { message },
    };
  };
  const handler: ProxyHandler<() => never> = {
    get(_target, prop) {
      // Let async/introspection probes (await, template coercion) pass instead of recursing.
      if (prop === "then" || prop === Symbol.toPrimitive || prop === Symbol.toStringTag) {
        return undefined;
      }
      return new Proxy(throwResponse, handler);
    },
    apply: () => throwResponse(),
  };
  return new Proxy(throwResponse, handler) as unknown as ReturnType<typeof buildShopify>;
}

let shopify: ReturnType<typeof buildShopify>;
if (missingRequiredEnv.length > 0) {
  shopifyInitError =
    `Missing required environment variable(s): ${missingRequiredEnv.join(", ")}. ` +
    `Set them on the Vercel project that serves this deployment ` +
    `(Project → Settings → Environment Variables, Production scope), then redeploy.`;
  console.error(`[te-configurator] ${shopifyInitError}`);
  shopify = makeConfigErrorProxy(shopifyInitError);
} else {
  try {
    shopify = buildShopify();
  } catch (e) {
    // Vars present but shopifyApp still rejected the config (malformed URL etc.) — same
    // containment: boot anyway, fail loudly per-request instead of killing every route.
    shopifyInitError =
      `Shopify config failed to initialize: ${e instanceof Error ? e.message : String(e)} — ` +
      `check the environment variables on the Vercel project serving this deployment.`;
    console.error(`[te-configurator] ${shopifyInitError}`);
    shopify = makeConfigErrorProxy(shopifyInitError);
  }
}

export default shopify;
export const apiVersion = ApiVersion.January25;
// entry.server calls this on EVERY document request — if it threw when misconfigured, no route
// (not even /healthz or the error page itself) could render. Decorating response headers is
// safe to skip in that state, so it degrades to a no-op instead of a thrower.
export const addDocumentResponseHeaders: typeof shopify.addDocumentResponseHeaders =
  shopifyInitError !== null ? () => {} : shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;

export function getFixedShop(): string | undefined {
  return process.env.SHOP?.replace(/^https?:\/\//, "").replace(/\/$/, "");
}
