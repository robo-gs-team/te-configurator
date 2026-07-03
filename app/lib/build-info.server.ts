// Captured once when this server module first loads (i.e. on cold start — right after a
// fresh deploy, or whenever Vercel spins up a new instance). Not a precise "deployed at"
// timestamp, but a reliable freshness signal: if it says days ago right after you deployed,
// an old warm instance is still serving traffic.
const SERVER_STARTED_AT = new Date().toISOString();

export type BuildInfo = {
  shortSha: string;
  commitUrl: string | null;
  serverStartedAt: string;
};

export function getBuildInfo(): BuildInfo {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  return {
    shortSha: sha ? sha.slice(0, 7) : "dev",
    commitUrl: sha ? `https://github.com/robo-gs-team/te-configurator/commit/${sha}` : null,
    serverStartedAt: SERVER_STARTED_AT,
  };
}
