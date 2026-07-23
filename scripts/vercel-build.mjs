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

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const derivedDirect = deriveSupabaseSessionUrl(databaseUrl);
if (derivedDirect) {
  process.env.DIRECT_URL = derivedDirect;
  console.log("DIRECT_URL derived from DATABASE_URL (Supabase session pooler, port 5432)");
} else if (!process.env.DIRECT_URL) {
  console.error("DIRECT_URL is not set");
  process.exit(1);
}

const env = { ...process.env };

function run(command) {
  console.log(`\n> ${command}`);
  execSync(command, { stdio: "inherit", env });
}

run("npx prisma generate");

// Preview and Production builds point at the same database (Vercel env vars aren't scoped
// per-branch here), so running `migrate deploy` on every Preview build races Production's own
// migrate step against the same Supabase connection/advisory lock — the likely cause of the
// intermittent, non-reproducible Preview build failures seen on this branch — and would also
// apply an unmerged PR's migration to the live DB before review. Only Production should migrate;
// Preview builds run against whatever schema is already live.
if (process.env.VERCEL_ENV === "production") {
  run("npx prisma migrate deploy");
} else {
  console.log(`\nSkipping migrate deploy (VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"})`);
}

run("npm run build");
