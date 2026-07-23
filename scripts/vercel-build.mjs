/**
 * Vercel build: derive Supabase DIRECT_URL from DATABASE_URL so migrate deploy
 * always uses the same credentials (avoids P1000 when DIRECT_URL was mistyped).
 */
import { execSync } from "child_process";

function deriveSupabaseSessionUrl(databaseUrl) {
  if (!databaseUrl?.includes("pooler.supabase.com")) {
    return null;
  }
  return databaseUrl.replace(":6543/", ":5432/").replace(/\?.*$/, "");
}

const env = { ...process.env };

function run(command) {
  console.log(`\n> ${command}`);
  execSync(command, { stdio: "inherit", env });
}

run("npx prisma generate");

// migrate deploy runs ONLY on Production. Preview and Production point at the same database, so
// migrating on every Preview build races Production's own migrate step for the same Supabase
// connection/advisory lock, and would apply an unmerged PR's migration to the live DB before
// review. Crucially, because only Production migrates, only Production needs the database
// connection env vars at build time — `prisma generate` and the Remix/Vite build never touch the
// DB (verified). So the DB env-var requirement lives INSIDE this branch: a Preview build must not
// hard-fail just because DATABASE_URL/DIRECT_URL aren't configured, which is exactly what breaks
// every Preview build on a newly-connected Vercel project whose Preview env has no DB vars yet.
if (process.env.VERCEL_ENV === "production") {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set (required for Production migrate deploy)");
    process.exit(1);
  }
  const derivedDirect = deriveSupabaseSessionUrl(databaseUrl);
  if (derivedDirect) {
    env.DIRECT_URL = derivedDirect;
    console.log("DIRECT_URL derived from DATABASE_URL (Supabase session pooler, port 5432)");
  } else if (!process.env.DIRECT_URL) {
    console.error("DIRECT_URL is not set (required for Production migrate deploy)");
    process.exit(1);
  }
  run("npx prisma migrate deploy");
} else {
  console.log(
    `\nSkipping migrate deploy + DB env checks (VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"}) — ` +
      "Preview/dev builds don't migrate and don't need database env vars.",
  );
}

run("npm run build");
