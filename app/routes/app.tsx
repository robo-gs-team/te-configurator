import type { HeadersFunction, LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import {
  Link,
  Outlet,
  isRouteErrorResponse,
  useLoaderData,
  useRouteError,
} from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import tailwindStyles from "~/styles/tailwind.css?url";

import { authenticate } from "../shopify.server";

export const links = () => [
  { rel: "stylesheet", href: polarisStyles },
  { rel: "stylesheet", href: tailwindStyles },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return json({ apiKey: process.env.SHOPIFY_API_KEY || "" });
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home">
          Dashboard
        </Link>
        <Link to="/app/configurators">Configurators</Link>
        <Link to="/app/settings">Theme Settings</Link>
        <Link to="/app/analytics">Analytics</Link>
      </NavMenu>
      <Outlet />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();

  // shopify.server throws this specific 503 when required env vars are missing/invalid. It must
  // be handled BEFORE Shopify's boundary.error, which re-throws anything it doesn't recognize —
  // that re-throw during the error render used to collapse the entire page into a blank
  // "Unexpected Server Error"/"Application Error" with no diagnostics (verified locally).
  // Everything else still goes through boundary.error so embedded-auth retries keep working.
  if (isRouteErrorResponse(error) && error.statusText === "Server misconfigured") {
    const message =
      (error.data as { message?: string } | null)?.message ??
      "The app server is misconfigured.";
    return (
      <div style={{ maxWidth: 560, margin: "12vh auto 0", padding: "0 20px", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ background: "#fff", border: "1px solid #e1e3e5", borderRadius: 12, padding: "28px 28px 24px" }}>
          <h1 style={{ fontSize: 18, margin: "0 0 10px" }}>App configuration problem</h1>
          <p style={{ fontSize: 14, lineHeight: 1.55, color: "#44474a", margin: "0 0 14px" }}>{message}</p>
          <p style={{ fontSize: 13, color: "#6d7175", margin: 0 }}>
            Live diagnostic: <a href="/healthz" style={{ color: "#2c6ecb" }}>/healthz</a> shows
            configuration and database status.
          </p>
        </div>
      </div>
    );
  }

  return boundary.error(error);
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
