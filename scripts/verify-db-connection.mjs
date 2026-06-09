/**
 * Test DATABASE_URL and DIRECT_URL before deploying to Vercel.
 * Usage: node scripts/verify-db-connection.mjs
 */
import { execSync } from "child_process";

function maskUrl(url) {
  if (!url) return "(not set)";
  return url.replace(/:([^:@/]+)@/, ":***@");
}

function check(name, url) {
  if (!url) {
    console.log(`❌ ${name}: not set`);
    return false;
  }

  if (url.includes("REGION")) {
    console.log(`❌ ${name}: still contains REGION placeholder`);
    return false;
  }

  if (url.includes("db.") && url.includes(".supabase.co:5432")) {
    console.log(`❌ ${name}: uses direct Supabase host (db.*.supabase.co:5432) — Vercel cannot reach this`);
    return false;
  }

  try {
    execSync("npx prisma db execute --url " + JSON.stringify(url) + " --stdin", {
      input: "SELECT 1 AS ok;",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 20000,
    });
    console.log(`✅ ${name}: connected (${maskUrl(url)})`);
    return true;
  } catch (error) {
    const output = (error.stderr?.toString() || error.stdout?.toString() || error.message || "").trim();
    const line =
      output.split("\n").find((l) => /FATAL|Error|P1001|tenant|authentication/i.test(l)) ||
      output.split("\n").slice(-2).join(" ");
    console.log(`❌ ${name}: ${line.slice(0, 220)}`);
    console.log(`   URL: ${maskUrl(url)}`);
    return false;
  }
}

const databaseUrl = process.env.DATABASE_URL;
const directUrl = process.env.DIRECT_URL;

console.log("Checking database connection strings...\n");

const databaseOk = check("DATABASE_URL (port 6543, transaction pooler)", databaseUrl);
const directOk = check("DIRECT_URL (port 5432, session pooler)", directUrl);

if (databaseUrl && directUrl) {
  const dbPass = databaseUrl.match(/:([^:@/]+)@/)?.[1];
  const directPass = directUrl.match(/:([^:@/]+)@/)?.[1];
  if (dbPass && directPass && dbPass !== directPass) {
    console.log("\n⚠️  Passwords differ between DATABASE_URL and DIRECT_URL — they must match.");
  }
}

console.log("\nIf either check failed:");
console.log("1. Supabase Dashboard → your project → Connect");
console.log("2. Copy Transaction pooler URI → DATABASE_URL (add ?pgbouncer=true)");
console.log("3. Copy Session pooler URI → DIRECT_URL");
console.log("4. Do NOT type the hostname manually — copy it from Supabase");
console.log("5. If unsure, reset the database password in Settings → Database");
console.log("6. Paste the same values into Vercel → Settings → Environment Variables");

process.exit(databaseOk && directOk ? 0 : 1);
