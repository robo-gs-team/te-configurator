import { PrismaClient } from "@prisma/client";

declare global {
  var prismaGlobal: PrismaClient | undefined;
}

/**
 * Supabase's TRANSACTION pooler (port 6543) hands the same physical Postgres connection to
 * different clients between statements. Prisma uses named prepared statements by default, which
 * then collide across those clients — surfacing as `PrismaClientUnknownRequestError` ("prepared
 * statement \"s0\" already exists") on even a trivial `SELECT 1`, and taking the whole app down
 * with it (admin pages, the storefront catalog endpoint, everything). `?pgbouncer=true` tells
 * Prisma to stop using named prepared statements.
 *
 * That flag is required configuration, not a tuning knob, so we repair it here rather than
 * depending on whoever last edited the env var remembering it. Only applied when the URL actually
 * points at the 6543 pooler and the flag is absent; the direct/session connection (5432) is left
 * alone, since there the flag would needlessly give up prepared statements.
 *
 * @returns the URL to connect with, or undefined to let Prisma resolve DATABASE_URL itself.
 */
function poolerSafeDatabaseUrl(): string | undefined {
  const url = process.env.DATABASE_URL;
  if (!url) return undefined;
  const isTransactionPooler = url.includes(":6543/");
  const alreadyFlagged = /[?&]pgbouncer=true\b/.test(url);
  if (!isTransactionPooler || alreadyFlagged) return url;
  return `${url}${url.includes("?") ? "&" : "?"}pgbouncer=true`;
}

function createClient(): PrismaClient {
  const url = poolerSafeDatabaseUrl();
  // Pass datasources only when we have a URL, so Prisma's own (clearer) error message survives
  // when DATABASE_URL is missing entirely.
  return url ? new PrismaClient({ datasources: { db: { url } } }) : new PrismaClient();
}

// Reuse the same client across hot-reloads in dev AND across warm invocations in production.
// Without this, every serverless cold-start (and every HMR cycle in dev) creates a new pool.
const prisma = global.prismaGlobal ?? (global.prismaGlobal = createClient());

export default prisma;
