import { waitUntil } from "@vercel/functions";

/**
 * Run best-effort background work WITHOUT blocking the HTTP response.
 *
 * On Vercel, `waitUntil` registers the promise so the serverless function stays alive until it
 * settles even though the response has already been flushed — so the caller can `return` immediately
 * while the work (e.g. a snapshot rebuild) finishes in the background. Outside a Vercel request
 * context (local `remix dev`, tests) `waitUntil` may throw; we fall back to a fire-and-forget so the
 * work still runs against the long-lived dev server.
 *
 * The `work` MUST be best-effort / never-throw on its own — nothing awaits or surfaces its result.
 */
export function runAfterResponse(work: () => Promise<unknown>): void {
  let promise: Promise<unknown>;
  try {
    promise = Promise.resolve(work());
  } catch (err) {
    // Synchronous throw while kicking off the work — log and give up (best-effort).
    console.error("runAfterResponse: work threw synchronously:", err);
    return;
  }
  // Never let an unhandled rejection crash the process.
  promise = promise.catch((err) => {
    console.error("runAfterResponse: background work failed:", err);
  });
  try {
    waitUntil(promise);
  } catch {
    // Not in a Vercel function context (e.g. local dev). The promise is already running; on a
    // long-lived server it will complete on its own. Nothing more to do.
  }
}
