/**
 * Per-stage server timings, emitted as a standard `Server-Timing` header.
 *
 * Originally written for the storefront catalog endpoint, where it is what turned "the
 * configurator is slow" into "one query in the fast path fetches a relation tree it never reads."
 * The admin needs the same thing for the same reason: from the browser, a slow admin page is a
 * single opaque wait, and the plausible causes — cold start, session lookup, DB round trips,
 * Shopify Admin API calls — are indistinguishable without a breakdown. Guessing between them is
 * how you end up optimizing the fast part.
 *
 * Chrome renders these in the request's Timing tab (Network → the `?_data=…` request on an admin
 * navigation, or the document request on a full load). `X-Proto-Timing` carries the same string
 * verbatim for anyone reading raw headers or a log line.
 */
export function startTimings() {
  const t0 = Date.now();
  let last = t0;
  const marks: string[] = [];
  return {
    /** Record elapsed time since the previous mark (or request start). */
    mark(name: string) {
      const now = Date.now();
      marks.push(`${name};dur=${now - last}`);
      last = now;
    },
    /** Serialize, appending a total. Safe to call once per response. */
    header(): string {
      return [...marks, `total;dur=${Date.now() - t0}`].join(", ");
    },
  };
}

export type Timings = ReturnType<typeof startTimings>;

/**
 * Timing headers for an admin loader response.
 *
 * Set on the loader's own response so they appear on the `?_data=…` fetch Remix makes for a
 * client-side navigation — which is where admin slowness is actually felt, since the app shell
 * stays mounted and only the route data is re-fetched.
 */
export function timingHeaders(timings: Timings): Record<string, string> {
  const timing = timings.header();
  return {
    "Server-Timing": timing,
    "X-Proto-Timing": timing,
  };
}
