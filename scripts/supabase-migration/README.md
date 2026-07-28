# Moving the database to the US — dashboard only

Runs entirely in the Supabase SQL Editor. No terminal, no local checkout.

Both files are generated from `prisma/schema.prisma`, so they match the app exactly.
Regenerate after any schema change (see the bottom of this file).

## 1. Create the schema

New (US) project → **SQL Editor** → new query → paste all of **`1-schema.sql`** → **Run**.

Creates all 11 tables plus their indexes and foreign keys. Nothing else.

## 2. Copy the data

Open **`2-copy-data.sql`**. Find the line marked `CHANGE ME` and replace the placeholder
connection string with the **OLD** project's **Session pooler (port 5432)** URI, password
included — old project → **Connect** → *Session pooler*.

Then paste the whole file into the new project's SQL Editor and **Run**.

It uses the `dblink` extension so this database reads directly from the old one; nothing is
downloaded and re-uploaded. Tables are copied parents-first so foreign keys hold at every step,
and every insert is `ON CONFLICT DO NOTHING`, so re-running after a partial failure is safe.

The last statement prints row counts — compare them against the old project.

### Why the Session pooler and not the Transaction pooler
dblink holds a connection open across statements. The transaction pooler (6543) hands
connections between clients between statements and will break that; the session pooler (5432)
does not.

## 3. Point the app at it

Vercel → Settings → Environment Variables (Production):

- `DATABASE_URL` → new **Transaction** pooler (6543) **+ `?pgbouncer=true`**
- `DIRECT_URL` → new **Session** pooler (5432)

Then **redeploy** — env var changes do not reach the already-running deployment.

Confirm with `/healthz`: expect `"ok": true` and `"db": "ok"`.

## If step 2 fails to connect

The old project is restricted for exceeding its free-plan egress quota, and a restricted project
may refuse connections outright. If dblink cannot reach it, upgrade the OLD project to Pro just
long enough to copy off it, then downgrade or delete it.

## Notes

- `_prisma_migrations` is copied too, so future `prisma migrate deploy` runs know these migrations
  are already applied instead of trying to re-run them.
- The `Session` table carries the Shopify OAuth session, so the app stays authenticated — no
  reinstall needed.
- Keep the old project for a week before deleting it.

## Regenerating

    npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script
