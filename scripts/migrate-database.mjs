/**
 * Copy this app's entire database from one Postgres to another — used to move the Supabase
 * project to a region near the app (the original was provisioned in Sydney while the app and its
 * shoppers are in the US, adding a Pacific round-trip to every query).
 *
 * Deliberately uses Prisma rather than pg_dump/pg_restore: no external binaries, no
 * client/server version-matching, and it works against Supabase's pooler. The dataset is small
 * (~27 MB, 11 tables), so a straightforward read-all/write-all is both fast and easy to verify.
 *
 * SAFETY
 *   - The SOURCE is only ever read from.
 *   - The TARGET must already have the schema applied (`prisma migrate deploy`) and must be EMPTY,
 *     unless --force is passed. Refusing to write into a non-empty database is deliberate: the
 *     likeliest mistake here is pointing TARGET at the database you meant to copy FROM.
 *   - Tables are written parents-first so foreign keys are satisfied at every step, and verified
 *     row-for-row at the end.
 *
 * USAGE
 *   SOURCE_DATABASE_URL="postgresql://…old-sydney…" \
 *   TARGET_DATABASE_URL="postgresql://…new-us…" \
 *   node scripts/migrate-database.mjs [--dry-run] [--force]
 */
import { PrismaClient } from "@prisma/client";

const SOURCE = process.env.SOURCE_DATABASE_URL;
const TARGET = process.env.TARGET_DATABASE_URL;
const FORCE = process.argv.includes("--force");
/** Read + report only. Proves both databases are reachable and shows exactly what WOULD be
 *  copied, without writing a single row — worth doing first on a one-shot data move. */
const DRY_RUN = process.argv.includes("--dry-run");

if (!SOURCE || !TARGET) {
  console.error("Set both SOURCE_DATABASE_URL and TARGET_DATABASE_URL.");
  process.exit(1);
}
if (SOURCE === TARGET) {
  console.error("SOURCE and TARGET are the same database. Refusing.");
  process.exit(1);
}

/**
 * Parents before children, so every insert's foreign keys already exist.
 * Session and Shop are roots; SavedConfiguration references a configurator by id but without a
 * DB-level FK, so its position only needs to follow Configurator for readability.
 */
const TABLES = [
  "session",
  "shop",
  "configurator",
  "configuratorStep",
  "optionGroup",
  "option",
  "conditionalRule",
  "addon",
  "themeSetting",
  "analytics",
  "savedConfiguration",
];

/** Supabase's transaction pooler needs this or Prisma's prepared statements collide. */
function poolerSafe(url) {
  return url.includes(":6543/") && !/[?&]pgbouncer=true\b/.test(url)
    ? `${url}${url.includes("?") ? "&" : "?"}pgbouncer=true`
    : url;
}

/**
 * Strip credentials/hosts from an error before printing. Postgres and Prisma errors routinely
 * echo the full connection URI, and the expected workflow here is "run it, paste the output to
 * someone for help" — so the output must be safe to share by default, not safe-if-you-remember.
 */
function redact(message) {
  return String(message)
    .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"']+/gi, "[connection-string]")
    .replace(/\b[\w.-]+:[^\s@/]+@[\w.-]+/g, "[credentials]")
    .replace(/\b\d{1,3}(\.\d{1,3}){3}\b/g, "[ip]")
    // Prisma also prints a bare `host:port` (no scheme, no credentials) in reachability errors.
    .replace(/[\w.-]*supabase\.(com|co)(:\d+)?/gi, "[db-host]");
}

const source = new PrismaClient({ datasources: { db: { url: poolerSafe(SOURCE) } } });
const target = new PrismaClient({ datasources: { db: { url: poolerSafe(TARGET) } } });

/** Insert in chunks: one giant createMany can exceed the pooler's statement limits. */
const CHUNK = 500;

async function main() {
  console.log(DRY_RUN ? "DRY RUN — nothing will be written.\n" : "");
  console.log("Connecting…");
  await source.$queryRaw`SELECT 1`;
  await target.$queryRaw`SELECT 1`;
  console.log("Both databases reachable.\n");

  if (DRY_RUN) {
    let total = 0;
    for (const table of TABLES) {
      const [from, to] = await Promise.all([source[table].count(), target[table].count()]);
      total += from;
      console.log(`${table.padEnd(20)} source=${String(from).padStart(6)}  target=${to}`);
    }
    console.log(`\n${total} row(s) would be copied. Re-run without --dry-run to perform it.`);
    return;
  }

  // Refuse to write into a database that already has data, unless explicitly forced.
  if (!FORCE) {
    for (const table of TABLES) {
      const existing = await target[table].count();
      if (existing > 0) {
        console.error(
          `TARGET is not empty: "${table}" already has ${existing} row(s).\n` +
            `If you intend to merge into this database anyway, re-run with --force.`,
        );
        process.exit(1);
      }
    }
    console.log("TARGET verified empty.\n");
  }

  const counts = {};
  for (const table of TABLES) {
    const rows = await source[table].findMany();
    counts[table] = rows.length;
    if (rows.length === 0) {
      console.log(`${table.padEnd(20)} 0 rows`);
      continue;
    }
    for (let i = 0; i < rows.length; i += CHUNK) {
      // skipDuplicates makes a re-run after a partial failure safe to repeat.
      await target[table].createMany({ data: rows.slice(i, i + CHUNK), skipDuplicates: true });
    }
    console.log(`${table.padEnd(20)} ${rows.length} rows copied`);
  }

  console.log("\nVerifying…");
  let mismatch = false;
  for (const table of TABLES) {
    const after = await target[table].count();
    const ok = after === counts[table];
    if (!ok) mismatch = true;
    console.log(`  ${ok ? "✅" : "❌"} ${table.padEnd(20)} source=${counts[table]} target=${after}`);
  }

  if (mismatch) {
    console.error("\n❌ Row counts differ — do NOT switch DATABASE_URL yet.");
    process.exit(1);
  }
  console.log("\n✅ Migration complete and verified.");
}

main()
  .catch((e) => {
    console.error("\n❌ Migration failed:", redact(e.message));
    process.exit(1);
  })
  .finally(async () => {
    await source.$disconnect().catch(() => {});
    await target.$disconnect().catch(() => {});
  });
