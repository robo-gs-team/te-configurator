# Supabase region migration (Sydney → US)

Copy schema + data from the old Sydney project into **Tennis Express Configurator V2.0** (`vvgukncmqnlbiddljmfe`).

## Before you start

1. Keep the old Sydney project — do not delete it yet.
2. Have both **Session pooler** URIs ready (port **5432**):
   - Old (Sydney) — source of data
   - New (US) — already in Vercel as `DIRECT_URL`
3. Prefer the **Node script** if SQL `dblink` fails (common on hosted Supabase).

---

## Path A — Supabase SQL Editor (dashboard)

### Step 0 — Check whether tables already exist

1. Open the **new US** project.
2. Left sidebar → **Table Editor**.
3. If you already see `Session`, `Shop`, `Configurator`, etc., **skip Step 1** (Vercel `prisma migrate deploy` likely created them). Go to Step 2.

### Step 1 — Create schema (new project only, if tables are missing)

1. New US project → **SQL Editor** → **New query**.
2. Open `1-schema.sql` from this folder, paste all of it, click **Run**.
3. Success = no errors (or “already exists” means skip and continue).

### Step 2 — Copy data from Sydney

1. Open the **old Sydney** project → **Connect** → **ORM** → Prisma.
2. Copy the **Session** / `DIRECT_URL` string (port **5432**). Keep the real password.
3. New US project → **SQL Editor** → **New query**.
4. Open `2-copy-data.sql`.
5. Replace `'CHANGE ME'` with your old Session pooler string, e.g.:

```sql
old_conn text := 'postgresql://postgres.OLDREF:OLD_PASSWORD@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres';
```

6. Click **Run**.

If you get an error about `dblink`, extensions, or outbound connections → use **Path B** below.

### Step 3 — Verify row counts

1. On **new US** → SQL Editor → paste and run `3-verify-counts.sql`. Note the counts.
2. On **old Sydney** → SQL Editor → run the **same** SQL. Counts must match table-by-table.
3. Especially check **`Session`** (Shopify OAuth) and **`Configurator`**.

---

## Path B — Local Node script (recommended if dblink fails)

From the repo root (PowerShell), with **both Session pooler (5432)** URLs:

```powershell
$env:OLD_DATABASE_URL="postgresql://postgres.OLDREF:OLD_PASSWORD@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres"
$env:NEW_DATABASE_URL="postgresql://postgres.vvgukncmqnlbiddljmfe:te-configurator@aws-0-<REGION>.pooler.supabase.com:5432/postgres"
node scripts/migrate-database.mjs
```

The script copies all 11 tables and prints old vs new row counts.

---

## After data matches

1. Confirm Vercel Production `DATABASE_URL` / `DIRECT_URL` point at the **new** project (already done if you finished that step).
2. Redeploy if needed.
3. Hit `/healthz` → `"db": "ok"`.
4. Open Shopify admin embed; place a test order.
5. Keep Sydney ~1 week, then delete.
