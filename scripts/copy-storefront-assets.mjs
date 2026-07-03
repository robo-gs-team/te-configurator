import { cpSync, mkdirSync, readdirSync, rmSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const buildDir = join(root, "build", "storefront");
const assetsDir = join(root, "extensions", "proto-configurator", "assets");

const ALLOWED = new Set([
  "proto-configurator.js",
  "proto-configurator.css",
  "proto-configurator-modal.js",
]);

// Wipe extension assets — only .js/.css allowed by Shopify
mkdirSync(assetsDir, { recursive: true });
for (const file of readdirSync(assetsDir)) {
  if (!ALLOWED.has(file)) {
    rmSync(join(assetsDir, file), { force: true });
    console.log(`Removed invalid asset: ${file}`);
  }
}

cpSync(join(buildDir, "proto-configurator.js"), join(assetsDir, "proto-configurator.js"));
cpSync(join(buildDir, "proto-configurator.css"), join(assetsDir, "proto-configurator.css"));
cpSync(
  join(buildDir, "proto-configurator-modal.js"),
  join(assetsDir, "proto-configurator-modal.js"),
);

console.log("Storefront assets copied to theme extension.");
