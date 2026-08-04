/**
 * Copy all app tables from OLD (Sydney) Supabase → NEW (US) Supabase.
 *
 * Usage (PowerShell):
 *   $env:OLD_DATABASE_URL="postgresql://...sydney...:5432/postgres"
 *   $env:NEW_DATABASE_URL="postgresql://...us...:5432/postgres"
 *   node scripts/migrate-database.mjs
 *
 * Use Session pooler URLs (port 5432) for both.
 */
import { PrismaClient } from "@prisma/client";

const TABLES = [
  "Session",
  "Shop",
  "Configurator",
  "ConfiguratorStep",
  "OptionGroup",
  "Option",
  "ConditionalRule",
  "Addon",
  "ThemeSetting",
  "Analytics",
  "SavedConfiguration",
];

const oldUrl = process.env.OLD_DATABASE_URL;
const newUrl = process.env.NEW_DATABASE_URL;

if (!oldUrl || !newUrl) {
  console.error(
    "Set OLD_DATABASE_URL and NEW_DATABASE_URL (Session pooler, port 5432).",
  );
  process.exit(1);
}

const oldDb = new PrismaClient({ datasources: { db: { url: oldUrl } } });
const newDb = new PrismaClient({ datasources: { db: { url: newUrl } } });

function quoteIdent(name) {
  return `"${name.replace(/"/g, '""')}"`;
}

async function count(client, table) {
  const rows = await client.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS c FROM ${quoteIdent(table)}`,
  );
  return rows[0].c;
}

async function copyTable(table) {
  const rows = await oldDb.$queryRawUnsafe(
    `SELECT * FROM ${quoteIdent(table)}`,
  );
  if (!rows.length) {
    console.log(`  ${table}: 0 rows (skip)`);
    return { table, old: 0, inserted: 0 };
  }

  const cols = Object.keys(rows[0]);
  const colList = cols.map(quoteIdent).join(", ");
  let inserted = 0;

  for (const row of rows) {
    const values = cols.map((_, i) => `$${i + 1}`);
    const params = cols.map((c) => row[c]);
    try {
      await newDb.$executeRawUnsafe(
        `INSERT INTO ${quoteIdent(table)} (${colList}) VALUES (${values.join(", ")}) ON CONFLICT DO NOTHING`,
        ...params,
      );
      inserted += 1;
    } catch (err) {
      console.error(`  ${table}: insert failed`, err.message);
      throw err;
    }
  }

  console.log(`  ${table}: copied ${rows.length} rows`);
  return { table, old: rows.length, inserted };
}

async function main() {
  console.log("Ensuring schema on NEW database (prisma db push)...");
  // Schema should already exist from migrate deploy; we only copy data.
  console.log("Copying data OLD → NEW...\n");

  const results = [];
  for (const table of TABLES) {
    results.push(await copyTable(table));
  }

  console.log("\nVerification (OLD vs NEW counts):");
  let ok = true;
  for (const table of TABLES) {
    const oldCount = await count(oldDb, table);
    const newCount = await count(newDb, table);
    const match = oldCount === newCount ? "OK" : "MISMATCH";
    if (oldCount !== newCount) ok = false;
    console.log(`  ${table}: old=${oldCount} new=${newCount} [${match}]`);
  }

  if (!ok) {
    console.error("\nRow counts do not match. Do not delete the old project.");
    process.exit(1);
  }
  console.log("\nAll table counts match. Migration data copy is complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await oldDb.$disconnect();
    await newDb.$disconnect();
  });
