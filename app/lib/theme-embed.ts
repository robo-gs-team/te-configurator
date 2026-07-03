// Client-safe: no Admin API calls, no secrets. Kept OUT of theme-detection.server.ts
// specifically so route components (which run in the browser bundle too) can import
// themeEditorEmbedUrl without Remix's Vite plugin rejecting the build — a component
// may not import anything from a `.server.ts` module, even a pure helper like this one.

// The app-embed block in settings_data.json is identified by one of these. Shopify's exact
// key/type format varies by version, so detection matches on any of them for robustness:
//   - EXTENSION_UUID: the theme app extension `uid` (shopify.extension.toml)
//   - APP_CLIENT_ID: the app's API client id (shopify.app.toml)
//   - EMBED_HANDLE: the app-embed block filename (blocks/configurator-embed.liquid)
export const EXTENSION_UUID = "90a6476f-451c-7e03-48e1-1349fcf790520bc3eb8d";
export const APP_CLIENT_ID = "fd9710371f83899efbb78a277a55939f";
export const EMBED_HANDLE = "configurator-embed";

// Deep-link into Theme Editor > App embeds for this extension. The `activateAppId` value is
// `${uuid}/${embed-handle}`; even if it doesn't perfectly auto-activate across Shopify versions,
// `context=apps` always opens the App embeds panel where our embed is listed to toggle on.
export function themeEditorEmbedUrl(shopDomain: string, themeId: string): string {
  // themeId is a GID like "gid://shopify/OnlineStoreTheme/12345" — extract the numeric ID
  const numericId = themeId.split("/").pop() ?? "";
  const activateAppId = `${EXTENSION_UUID}/${EMBED_HANDLE}`;
  return `https://${shopDomain}/admin/themes/${numericId}/editor?context=apps&activateAppId=${activateAppId}`;
}
