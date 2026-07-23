import { json } from "@vercel/remix";
import { missingRequiredEnv, shopifyInitError } from "~/shopify.server";
import { getVersionInfo } from "~/lib/version.server";

/**
 * Public, unauthenticated liveness + configuration diagnostic: GET /healthz
 *
 * Exists because a production incident ("Application Error" on every admin route + the storefront
 * button vanishing on both channels) was undiagnosable from the outside — the blast radius of a
 * single missing env var on the serving Vercel project. This endpoint answers "what exactly is
 * wrong?" from any browser, no Vercel/log access required.
 *
 * Reports PRESENCE (booleans) of required env vars — never their values — plus database
 * reachability (error class only, connection details redacted) and the running version/commit.
 * 200 when healthy, 503 when degraded, so it also works as an uptime-monitor target.
 */
export const loader = async () => {
  const present = (key: string) => Boolean(process.env[key]?.trim());

  const env = {
    SHOPIFY_API_KEY: present("SHOPIFY_API_KEY"),
    SHOPIFY_API_SECRET: present("SHOPIFY_API_SECRET"),
    SHOPIFY_APP_URL: present("SHOPIFY_APP_URL"),
    SCOPES: present("SCOPES"),
    DATABASE_URL: present("DATABASE_URL"),
    CRON_SECRET: present("CRON_SECRET"),
    SHOP: present("SHOP"),
  };

  // DB check via dynamic import inside try/catch so even a client that throws on first use
  // (missing/invalid DATABASE_URL) reports as a readable status instead of crashing the route.
  let db: string;
  try {
    const { default: prisma } = await import("~/db.server");
    await prisma.$queryRaw`SELECT 1`;
    db = "ok";
  } catch (e) {
    // Redact anything that could contain host/credentials — the error NAME is diagnosis enough
    // (PrismaClientInitializationError = can't reach/authenticate; PrismaClientKnownRequestError
    // = reached but query failed; etc.).
    db = e instanceof Error ? `error: ${e.constructor.name}` : "error: unknown";
  }

  let versions: unknown;
  try {
    versions = getVersionInfo();
  } catch {
    versions = "unavailable";
  }

  const ok = missingRequiredEnv.length === 0 && !shopifyInitError && db === "ok";

  return json(
    {
      ok,
      shopify: shopifyInitError ?? "ok",
      missingRequiredEnv,
      env,
      db,
      versions,
      deployment: {
        vercelEnv: process.env.VERCEL_ENV ?? null,
        commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) ?? null,
      },
      time: new Date().toISOString(),
    },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
};
