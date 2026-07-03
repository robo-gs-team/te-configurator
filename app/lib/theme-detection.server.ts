import { APP_CLIENT_ID, EMBED_HANDLE, EXTENSION_UUID } from "~/lib/theme-embed";

type ShopifyAdmin = {
  graphql: (
    query: string,
    opts?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

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
