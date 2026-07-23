/**
 * Rolls the Stable channel back to the EXACT files from a previously promoted version — restored
 * byte-for-byte via `git show` from that version's recorded commit, not rebuilt (rebuilding from
 * old source could subtly differ if toolchain/dependencies moved on since then; restoring the
 * actual committed artifact is the only guarantee it's identical to what was live before).
 *
 * Like promote-stable.mjs, this never touches Shopify/Vercel directly and never rewrites
 * version-manifest.json history — a rollback is recorded as a NEW version entry (so "what was
 * live when" stays a truthful, append-only log), and a human still commits/PRs/merges to ship it.
 *
 * Usage: node scripts/rollback-stable.mjs v2
 */
import { execSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const manifestPath = join(root, "version-manifest.json");

const targetVersion = process.argv[2];
if (!targetVersion) {
  console.error("Usage: node scripts/rollback-stable.mjs <version>  (e.g. v2)");
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const target = manifest.history.find((h) => h.version === targetVersion);
if (!target) {
  console.error(
    `Version ${targetVersion} not found in version-manifest.json. Known versions: ` +
      manifest.history.map((h) => h.version).join(", "),
  );
  process.exit(1);
}

const dirty = execSync("git status --porcelain", { cwd: root }).toString().trim();
if (dirty) {
  console.error("Working tree has uncommitted changes. Commit or stash them first.");
  process.exit(1);
}

const STABLE_ASSETS = [
  "extensions/proto-configurator/assets/proto-configurator.js",
  "extensions/proto-configurator/assets/proto-configurator.css",
  "extensions/proto-configurator/assets/proto-configurator-modal.js",
];

console.log(`Restoring Stable assets exactly as they were at ${targetVersion} (commit ${target.commit.slice(0, 8)})...`);
for (const asset of STABLE_ASSETS) {
  const content = execSync(`git show ${target.commit}:${asset}`, { cwd: root });
  writeFileSync(join(root, asset), content);
  console.log(`  restored ${asset}`);
}

const lastVersion = manifest.history[manifest.history.length - 1];
const lastNum = parseInt(String(lastVersion?.version ?? "v0").replace("v", ""), 10) || 0;
const nextVersion = `v${lastNum + 1}`;

manifest.current = nextVersion;
manifest.history.push({
  version: nextVersion,
  commit: target.commit,
  promotedAt: new Date().toISOString(),
  label: `Rollback to ${targetVersion} ("${target.label}")`,
  rollbackOf: targetVersion,
});
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

console.log(`\nRecorded as ${nextVersion} (a rollback to ${targetVersion}'s exact code).`);
console.log("\nNext steps:");
console.log("  1. git add extensions/proto-configurator/assets/proto-configurator.js \\");
console.log("            extensions/proto-configurator/assets/proto-configurator.css \\");
console.log("            extensions/proto-configurator/assets/proto-configurator-modal.js \\");
console.log("            version-manifest.json");
console.log(`  2. git commit -m "chore: roll Stable back to ${targetVersion} (${nextVersion})"`);
console.log("  3. Open a PR, confirm Vercel is green, merge to main.");
console.log("  4. The Deploy Shopify workflow ships the restored bundle to every Stable-channel");
console.log("     theme (including the live theme) on that merge.");
