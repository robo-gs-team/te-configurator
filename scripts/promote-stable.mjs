/**
 * Promotes the CURRENT code (whatever's checked out — normally main, after Beta has been tested
 * on the draft theme) to the Stable release channel: rebuilds the stable bundle, records a new
 * version entry in version-manifest.json, and prints the exact next steps to ship it.
 *
 * This never touches Shopify or Vercel directly — promotion is a deliberate, reviewable git step:
 * this script only updates FILES; a human (or Claude, on request) still commits, opens a PR, and
 * merges, same as any other change. That's intentional — the whole point of Stable/Beta is that
 * nothing reaches the live theme without that explicit checkpoint.
 *
 * Usage: node scripts/promote-stable.mjs "short label describing what's being promoted"
 */
import { execSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const manifestPath = join(root, "version-manifest.json");

const label = process.argv[2];
if (!label) {
  console.error('Usage: node scripts/promote-stable.mjs "short label describing what changed"');
  process.exit(1);
}

const commit = execSync("git rev-parse HEAD", { cwd: root }).toString().trim();
const dirty = execSync("git status --porcelain", { cwd: root }).toString().trim();
if (dirty) {
  console.error(
    "Working tree has uncommitted changes. Commit or stash them first — the manifest " +
      "records the commit SHA being promoted, so it must reflect what's actually committed.",
  );
  process.exit(1);
}

console.log("Building STABLE bundle from current code...");
execSync("npm run build:storefront", { cwd: root, stdio: "inherit" });

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const lastVersion = manifest.history[manifest.history.length - 1];
const lastNum = parseInt(String(lastVersion?.version ?? "v0").replace("v", ""), 10) || 0;
const nextVersion = `v${lastNum + 1}`;

manifest.current = nextVersion;
manifest.history.push({
  version: nextVersion,
  commit,
  promotedAt: new Date().toISOString(),
  label,
});
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

console.log(`\nPromoted to ${nextVersion} (source commit ${commit.slice(0, 8)}).`);
console.log("\nNext steps:");
console.log("  1. git add extensions/proto-configurator/assets/proto-configurator.js \\");
console.log("            extensions/proto-configurator/assets/proto-configurator.css \\");
console.log("            extensions/proto-configurator/assets/proto-configurator-modal.js \\");
console.log("            version-manifest.json");
console.log(`  2. git commit -m "chore: promote ${nextVersion} to Stable — ${label}"`);
console.log("  3. Open a PR, confirm Vercel is green, merge to main.");
console.log("  4. The Deploy Shopify workflow ships this stable bundle to every Stable-channel");
console.log("     theme (including the live theme) on that merge.");
