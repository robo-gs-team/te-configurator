type ShopifyAdmin = {
  graphql: (
    query: string,
    opts?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

// The app-embed block in settings_data.json is identified by one of these. Shopify's exact
// key/type format varies by version, so we match on any of them for robustness:
//   - EXTENSION_UUID: the theme app extension `uid` (shopify.extension.toml)
//   - APP_CLIENT_ID: the app's API client id (shopify.app.toml)
//   - EMBED_HANDLE: the app-embed block filename (blocks/configurator-embed.liquid)
const EXTENSION_UUID = "90a6476f-451c-7e03-48e1-1349fcf790520bc3eb8d";
const APP_CLIENT_ID = "fd9710371f83899efbb78a277a55939f";
const EMBED_HANDLE = "configurator-embed";

export type ThemeButtonStatus = {
  live: boolean;
  themeName: string | null;
  themeId: string | null;
  detail: "active" | "embed_missing" | "unknown";
};

type SettingsBlock = { type?: unknown; disabled?: unknown };

/** True if a block's key or type string references our app embed. */
function blockMatchesOurEmbed(key: string, block: SettingsBlock): boolean {
  const type = typeof block?.type === "string" ? block.type : "";
  const hay = `${key} ${type}`;
  return (
    hay.includes(EXTENSION_UUID) ||
    hay.includes(APP_CLIENT_ID) ||
    hay.includes(EMBED_HANDLE)
  );
}

/**
 * Determine our app embed's state from a theme's settings_data.json.
 * App embeds live under `current.blocks`; a toggled-off embed keeps its entry but with
 * `disabled: true`. So presence alone is NOT "active" — we must find our block AND confirm
 * it isn't disabled. Falls back to a substring check only if the JSON can't be parsed.
 */
function detectEmbedState(content: string): "active" | "embed_missing" {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    // Unparseable — best-effort: presence of any of our identifiers (can't read disabled flag).
    return content.includes(EXTENSION_UUID) ||
      content.includes(APP_CLIENT_ID) ||
      content.includes(EMBED_HANDLE)
      ? "active"
      : "embed_missing";
  }

  const root = data as { current?: unknown; blocks?: unknown };
  const current = root?.current as { blocks?: unknown } | undefined;
  const containers = [current?.blocks, root?.blocks].filter(
    (b): b is Record<string, SettingsBlock> =>
      Boolean(b) && typeof b === "object",
  );

  for (const blocks of containers) {
    for (const [key, block] of Object.entries(blocks)) {
      if (blockMatchesOurEmbed(key, block)) {
        return block?.disabled === true ? "embed_missing" : "active";
      }
    }
  }
  return "embed_missing";
}

export async function detectThemeButtonStatus(
  admin: ShopifyAdmin,
): Promise<ThemeButtonStatus> {
  try {
    const themesRes = await admin.graphql(`
      #graphql
      query {
        themes(first: 10) {
          nodes { id name role }
        }
      }
    `);
    const themesJson = (await themesRes.json()) as {
      data?: {
        themes?: {
          nodes?: Array<{ id: string; name: string; role: string }>;
        };
      };
    };
    const mainTheme = themesJson.data?.themes?.nodes?.find(
      (t) => t.role === "MAIN",
    );
    if (!mainTheme) return { live: false, themeName: null, themeId: null, detail: "unknown" };

    const fileRes = await admin.graphql(
      `
      #graphql
      query GetThemeFile($id: ID!) {
        theme(id: $id) {
          files(filenames: ["config/settings_data.json"]) {
            nodes {
              filename
              body {
                ... on OnlineStoreThemeFileBodyText {
                  content
                }
              }
            }
          }
        }
      }
    `,
      { variables: { id: mainTheme.id } },
    );

    const fileJson = (await fileRes.json()) as {
      data?: {
        theme?: {
          files?: {
            nodes?: Array<{
              filename: string;
              body?: { content?: string };
            }>;
          };
        };
      };
    };
    const content =
      fileJson.data?.theme?.files?.nodes?.[0]?.body?.content;

    if (!content) {
      return {
        live: false,
        themeName: mainTheme.name,
        themeId: mainTheme.id,
        detail: "unknown",
      };
    }

    // App embed is live only when our block is present AND not disabled in settings_data.json
    const detail = detectEmbedState(content);
    return {
      live: detail === "active",
      themeName: mainTheme.name,
      themeId: mainTheme.id,
      detail,
    };
  } catch {
    return { live: false, themeName: null, themeId: null, detail: "unknown" };
  }
}

// Deep-link into Theme Editor > App embeds for this extension. The `activateAppId` value is
// `${uuid}/${embed-handle}`; even if it doesn't perfectly auto-activate across Shopify versions,
// `context=apps` always opens the App embeds panel where our embed is listed to toggle on.
export function themeEditorEmbedUrl(shopDomain: string, themeId: string): string {
  // themeId is a GID like "gid://shopify/OnlineStoreTheme/12345" — extract the numeric ID
  const numericId = themeId.split("/").pop() ?? "";
  const activateAppId = `${EXTENSION_UUID}/${EMBED_HANDLE}`;
  return `https://${shopDomain}/admin/themes/${numericId}/editor?context=apps&activateAppId=${activateAppId}`;
}
