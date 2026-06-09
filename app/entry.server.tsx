import { RemixServer } from "@remix-run/react";
import { handleRequest as vercelHandleRequest, type EntryContext } from "@vercel/remix";
import { addDocumentResponseHeaders } from "./shopify.server";

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext,
) {
  addDocumentResponseHeaders(request, responseHeaders);
  const remixServer = (
    <RemixServer context={remixContext} url={request.url} />
  );
  return vercelHandleRequest(
    request,
    responseStatusCode,
    responseHeaders,
    remixServer,
  );
}
