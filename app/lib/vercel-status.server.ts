// Live deployment status via Vercel's REST API, so the app itself can tell you whether the
// build you're looking at is the latest, or whether a newer one is deploying / just went live.
//
// Optional — requires two env vars set in the Vercel project:
//   VERCEL_API_TOKEN   — a Vercel access token (Account Settings → Tokens)
//   VERCEL_PROJECT_ID  — the project's ID (Project Settings → General → Project ID)
// If either is missing, or the API is slow/unreachable, this degrades silently to
// { configured:false } / { state:"unknown" } and the dashboard just shows the plain SHA line.

export type DeploymentStatus = {
  configured: boolean;
  // "up_to_date": the running build IS the latest production deployment and it's ready
  // "newer_building": a newer deployment is building/queued right now
  // "newer_ready": a newer deployment finished — this (warm) instance is just stale; refresh
  // "failed": the most recent production deployment errored
  // "unknown": couldn't determine (not configured, API error, or timed out)
  state: "up_to_date" | "newer_building" | "newer_ready" | "failed" | "unknown";
  latestShortSha: string | null;
};

let cache: { data: DeploymentStatus; expires: number } | null = null;
const TTL_MS = 60 * 1000; // avoid hammering the Vercel API (and the dashboard) on every load
const TIMEOUT_MS = 2000; // never let a slow Vercel API delay the dashboard

export async function getDeploymentStatus(): Promise<DeploymentStatus> {
  if (cache && cache.expires > Date.now()) return cache.data;

  const token = process.env.VERCEL_API_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  const servingSha = process.env.VERCEL_GIT_COMMIT_SHA ?? null;

  const store = (data: DeploymentStatus): DeploymentStatus => {
    cache = { data, expires: Date.now() + TTL_MS };
    return data;
  };

  if (!token || !projectId) {
    return store({ configured: false, state: "unknown", latestShortSha: null });
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(
      `https://api.vercel.com/v6/deployments?projectId=${encodeURIComponent(projectId)}&target=production&limit=1`,
      { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal },
    );
    clearTimeout(timer);

    if (!res.ok) {
      return store({ configured: true, state: "unknown", latestShortSha: null });
    }

    const json = (await res.json()) as {
      deployments?: Array<{
        state?: string;
        readyState?: string;
        meta?: { githubCommitSha?: string };
      }>;
    };
    const dep = json.deployments?.[0];
    if (!dep) {
      return store({ configured: true, state: "unknown", latestShortSha: null });
    }

    const latestSha = dep.meta?.githubCommitSha ?? null;
    const readyState = String(dep.state ?? dep.readyState ?? "").toUpperCase();
    const isSameBuild = Boolean(latestSha && servingSha && latestSha === servingSha);

    let state: DeploymentStatus["state"];
    if (readyState === "ERROR") {
      state = "failed";
    } else if (readyState === "READY") {
      state = isSameBuild ? "up_to_date" : "newer_ready";
    } else if (["BUILDING", "QUEUED", "INITIALIZING"].includes(readyState)) {
      // Only meaningful if it's a build we're not already running.
      state = isSameBuild ? "up_to_date" : "newer_building";
    } else {
      state = "unknown";
    }

    return store({
      configured: true,
      state,
      latestShortSha: latestSha ? latestSha.slice(0, 7) : null,
    });
  } catch {
    // Aborted (timeout) or network error — degrade silently.
    return store({ configured: true, state: "unknown", latestShortSha: null });
  }
}
