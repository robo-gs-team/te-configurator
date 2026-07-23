/**
 * Vercel build: prisma generate + app build ONLY. No database access, ever.
 *
 * `prisma migrate deploy` used to run here (Production builds only), but that made every
 * Production deploy depend on the build container having correct DB env vars AND network reach
 * to Supabase — which is exactly what kept failing on the production Vercel project while the
 * no-DB Preview path built the very same commit cleanly. Neither `prisma generate` nor the
 * Remix/Vite build touches the database (verified: both succeed with DATABASE_URL/DIRECT_URL
 * unset), so the build is now fully DB-independent and behaves identically across Production,
 * Preview, and local.
 *
 * Migrations are applied by CI instead: .github/workflows/migrate-db.yml runs
 * `prisma migrate deploy` on merge to main whenever prisma/migrations/** changes.
 */
import { execSync } from "child_process";

function run(command) {
  console.log(`\n> ${command}`);
  execSync(command, { stdio: "inherit" });
}

run("npx prisma generate");
run("npm run build");
