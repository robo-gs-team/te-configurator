type ShopifyAdmin = {
  graphql: (
    query: string,
    opts?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

// UUID from extensions/proto-configurator/shopify.extension.toml
const EXTENSION_UUID = "90a6476f-451c-7e03-48e1-1349fcf790520bc3eb8d";

export type ThemeButtonStatus = {
  live: boolean;
  themeName: string | null;
  themeId: string | null;
  detail: "active" | "embed_missing" | "unknown";
};

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

    // App embed is installed + active when our extension UUID is in settings_data.json
    const embedActive = content.includes(EXTENSION_UUID);
    return {
      live: embedActive,
      themeName: mainTheme.name,
      themeId: mainTheme.id,
      detail: embedActive ? "active" : "embed_missing",
    };
  } catch {
    return { live: false, themeName: null, themeId: null, detail: "unknown" };
  }
}

// Deep-link into Theme Editor > App embeds for this extension
export function themeEditorEmbedUrl(shopDomain: string, themeId: string): string {
  // themeId is a GID like "gid://shopify/OnlineStoreTheme/12345" — extract the numeric ID
  const numericId = themeId.split("/").pop() ?? "";
  return `https://${shopDomain}/admin/themes/${numericId}/editor?context=apps&activateAppId=${EXTENSION_UUID}`;
}
