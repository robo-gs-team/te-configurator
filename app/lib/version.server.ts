import manifest from "../../version-manifest.json";

export type StableVersionInfo = {
  version: string;
  commit: string;
  promotedAt: string;
  label: string;
  rollbackOf?: string;
};

/**
 * Version info for the admin's "Configurator Version" card.
 *
 * Stable comes from version-manifest.json — a committed file only ever updated by
 * scripts/promote-stable.mjs / rollback-stable.mjs, so it always reflects exactly what was
 * DELIBERATELY shipped to the Stable channel (and therefore the live theme), not just whatever
 * happens to be on main.
 *
 * Beta needs no separate tracking: the Beta channel always mirrors whatever's on `main` right
 * now, and this admin app is itself always running that same `main` (Vercel deploys it on every
 * push) — so "Beta's version" is just this deployment's own git commit, read live from Vercel's
 * automatic build-time env vars. No manifest entry can ever go stale, because there isn't one.
 */
export function getVersionInfo(): {
  stable: StableVersionInfo;
  beta: { commit: string | null; message: string | null; ref: string | null };
} {
  const history = manifest.history as StableVersionInfo[];
  const current =
    history.find((h) => h.version === manifest.current) ?? history[history.length - 1];

  return {
    stable: current,
    beta: {
      commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      message: process.env.VERCEL_GIT_COMMIT_MESSAGE ?? null,
      ref: process.env.VERCEL_GIT_COMMIT_REF ?? null,
    },
  };
}
