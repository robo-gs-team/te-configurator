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
/**
 * Strip anything credential- or host-shaped from an error message before it leaves the server.
 * /healthz is unauthenticated, so this must be conservative: full connection URIs, bare
 * user:pass@host pairs, and IP addresses all go, leaving the diagnostic prose (e.g. `prepared
 * statement "s0" already exists`) that identifies the actual failure.
 */
function redactSecrets(message: string): string {
  return message
    .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"']+/gi, "[connection-string]")
    .replace(/\b[\w.-]+:[^\s@/]+@[\w.-]+/g, "[credentials]")
    .replace(/\b\d{1,3}(\.\d{1,3}){3}\b/g, "[ip]")
    .slice(0, 300);
}

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
  // Round-trip time for the most trivial query there is. Everything the admin does is some
  // multiple of this number, so it separates "our queries are slow" from "the database is simply
  // far from the function" — a single-digit result means the two are colocated, while a
  // consistently high one means every round trip on every page is paying transit, and no amount
  // of query tuning will fix it (moving the function's region will).
  let dbRoundTripMs: number | null = null;
  try {
    const { default: prisma } = await import("~/db.server");
    const startedAt = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    dbRoundTripMs = Date.now() - startedAt;
    db = "ok";
  } catch (e) {
    // The error NAME alone proved NOT to be enough: a real outage reported
    // `PrismaClientUnknownRequestError` on `SELECT 1`, which is consistent with several very
    // different causes (missing ?pgbouncer=true on the transaction pooler, an exhausted pool, a
    // paused project). Include a sanitized message so the cause is identifiable from this endpoint
    // instead of guessed at — connection strings, credentials and IPs are stripped first, since
    // this route is public.
    db = e instanceof Error ? `error: ${e.constructor.name}` : "error: unknown";
    if (e instanceof Error && e.message) db += ` — ${redactSecrets(e.message)}`;
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
      dbRoundTripMs,
      versions,
      deployment: {
        vercelEnv: process.env.VERCEL_ENV ?? null,
        commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) ?? null,
        // Which region this function ran in. Paired with dbRoundTripMs it answers "is the
        // database next door or across an ocean?" — not otherwise visible without Vercel access.
        region: process.env.VERCEL_REGION ?? null,
      },
      time: new Date().toISOString(),
    },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
};
