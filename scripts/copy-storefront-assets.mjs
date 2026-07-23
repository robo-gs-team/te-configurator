import { cpSync, mkdirSync, readdirSync, rmSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const buildDir = join(root, "build", "storefront");
const assetsDir = join(root, "extensions", "proto-configurator", "assets");

// Which release channel this build produced (see the Stable/Beta system in
// configurator-embed.liquid + the vite configs). Stable writes `proto-configurator.*`; beta writes
// `proto-configurator.beta.*`.
const CHANNEL_SUFFIX = process.env.PROTO_CHANNEL === "beta" ? ".beta" : "";

// Every asset name BOTH channels can legitimately own. Anything else in the extension assets dir
// is invalid (Shopify only allows .js/.css) and gets removed — but we must KEEP the other channel's
// files, which is the whole point: a beta build must never delete the frozen stable bundle that the
// live theme loads (and vice-versa).
const ALLOWED = new Set([
  "proto-configurator.js",
  "proto-configurator.css",
  "proto-configurator-modal.js",
  "proto-configurator.beta.js",
  "proto-configurator.beta.css",
  "proto-configurator-modal.beta.js",
]);

// The files THIS build produced and should copy over (only the current channel's).
const CHANNEL_FILES = [
  `proto-configurator${CHANNEL_SUFFIX}.js`,
  `proto-configurator${CHANNEL_SUFFIX}.css`,
  `proto-configurator-modal${CHANNEL_SUFFIX}.js`,
];

mkdirSync(assetsDir, { recursive: true });

// Prune only genuinely-invalid files; never touch the other channel's frozen bundle.
for (const file of readdirSync(assetsDir)) {
  if (!ALLOWED.has(file)) {
    rmSync(join(assetsDir, file), { force: true });
    console.log(`Removed invalid asset: ${file}`);
  }
}

for (const file of CHANNEL_FILES) {
  const src = join(buildDir, file);
  if (!existsSync(src)) {
    throw new Error(
      `Expected build output missing: ${file} (PROTO_CHANNEL=${process.env.PROTO_CHANNEL ?? "stable"})`,
    );
  }
  cpSync(src, join(assetsDir, file));
}

console.log(
  `Storefront assets copied to theme extension (channel: ${CHANNEL_SUFFIX ? "beta" : "stable"}).`,
);
