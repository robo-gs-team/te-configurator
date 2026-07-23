import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useRouteError,
} from "@remix-run/react";

/**
 * Root error boundary — before this existed, ANY unhandled server error rendered as a bare
 * "Application Error" with zero information (which is how a missing env var on the Vercel
 * project presented in production). Now failures render a readable page: the real reason when
 * it's a thrown Response (e.g. shopify.server's 503 "Server misconfigured" with the missing
 * var names), and a pointer to /healthz — the live diagnostic — in every case.
 */
export function ErrorBoundary() {
  const error = useRouteError();

  let title = "Something went wrong";
  let detail = "";
  if (isRouteErrorResponse(error)) {
    title = `${error.status} ${error.statusText || "Error"}`;
    // shopify.server's config error carries { message } as data; other route errors may carry a
    // plain string.
    if (error.data && typeof error.data === "object" && "message" in error.data) {
      detail = String((error.data as { message?: unknown }).message ?? "");
    } else if (typeof error.data === "string") {
      detail = error.data;
    }
  } else if (error instanceof Error) {
    // In production Remix replaces server Error messages with "Unexpected Server Error" before
    // they reach the client — still worth rendering for dev and for client-side errors.
    detail = error.message;
  }

  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>{title}</title>
      </head>
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#f6f6f7" }}>
        <div style={{ maxWidth: 560, margin: "12vh auto 0", padding: "0 20px" }}>
          <div
            style={{
              background: "#fff",
              border: "1px solid #e1e3e5",
              borderRadius: 12,
              padding: "28px 28px 24px",
            }}
          >
            <h1 style={{ fontSize: 18, margin: "0 0 10px" }}>{title}</h1>
            {detail ? (
              <p style={{ fontSize: 14, lineHeight: 1.55, color: "#44474a", margin: "0 0 14px" }}>
                {detail}
              </p>
            ) : (
              <p style={{ fontSize: 14, lineHeight: 1.55, color: "#44474a", margin: "0 0 14px" }}>
                The app hit an unexpected error. Reloading usually clears a transient failure.
              </p>
            )}
            <p style={{ fontSize: 13, color: "#6d7175", margin: 0 }}>
              Live diagnostic:{" "}
              <a href="/healthz" style={{ color: "#2c6ecb" }}>
                /healthz
              </a>{" "}
              shows configuration and database status.
            </p>
          </div>
        </div>
      </body>
    </html>
  );
}

export default function App() {
  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
