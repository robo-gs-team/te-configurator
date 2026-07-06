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
  // When detail === "unknown", why — so the admin can show a specific hint instead of a
  // vague "Unknown". Populated by the detection; null on the success paths.
  reason:
    | "missing_theme_scope" // themes query returned an access/permission error
    | "no_published_theme" // query succeeded but no MAIN-role theme
    | "settings_unreadable" // theme found but its settings_data.json couldn't be read
    | "api_error" // request threw (network/throttle/etc.)
    | "graphql_error" // query returned some other GraphQL error
    | null;
};

// Two live Shopify Admin API round-trips (themes list + theme file) on every dashboard
// view was the main cause of slow admin navigation. The embed toggle changes rarely, so a
// short cache trades a little staleness for near-instant repeat page loads — same tradeoff
// already used for the storefront proxy cache.
const statusCache = new Map<string, { data: ThemeButtonStatus; expires: number }>();
const STATUS_TTL_MS = 60 * 1000; // 1 minute

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
  shopDomain: string,
): Promise<ThemeButtonStatus> {
  const cached = statusCache.get(shopDomain);
  if (cached && cached.expires > Date.now()) {
    return cached.data;
  }

  const result = await fetchThemeButtonStatus(admin);
  statusCache.set(shopDomain, { data: result, expires: Date.now() + STATUS_TTL_MS });
  return result;
}

// A GraphQL errors array from Shopify that mentions access/permission/scope means the app's
// token isn't allowed to read themes — almost always because read_themes was added to the app
// after it was installed, so the merchant needs to re-authorize.
function looksLikeScopeError(errors: unknown): boolean {
  const text = JSON.stringify(errors ?? "").toLowerCase();
  return (
    text.includes("access denied") ||
    text.includes("not approved") ||
    text.includes("scope") ||
    text.includes("permission") ||
    text.includes("read_themes")
  );
}

async function fetchThemeButtonStatus(admin: ShopifyAdmin): Promise<ThemeButtonStatus> {
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
      data?: { themes?: { nodes?: Array<{ id: string; name: string; role: string }> } };
      errors?: unknown;
    };

    if (themesJson.errors) {
      console.error("theme-detection: themes query returned errors:", JSON.stringify(themesJson.errors));
      return {
        live: false,
        themeName: null,
        themeId: null,
        detail: "unknown",
        reason: looksLikeScopeError(themesJson.errors) ? "missing_theme_scope" : "graphql_error",
      };
    }

    const mainTheme = themesJson.data?.themes?.nodes?.find((t) => t.role === "MAIN");
    if (!mainTheme) {
      return { live: false, themeName: null, themeId: null, detail: "unknown", reason: "no_published_theme" };
    }

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
        theme?: { files?: { nodes?: Array<{ filename: string; body?: { content?: string } }> } };
      };
      errors?: unknown;
    };

    if (fileJson.errors) {
      console.error("theme-detection: theme file query returned errors:", JSON.stringify(fileJson.errors));
      return {
        live: false,
        themeName: mainTheme.name,
        themeId: mainTheme.id,
        detail: "unknown",
        reason: looksLikeScopeError(fileJson.errors) ? "missing_theme_scope" : "settings_unreadable",
      };
    }

    const content = fileJson.data?.theme?.files?.nodes?.[0]?.body?.content;
    if (!content) {
      return {
        live: false,
        themeName: mainTheme.name,
        themeId: mainTheme.id,
        detail: "unknown",
        reason: "settings_unreadable",
      };
    }

    // App embed is live only when our block is present AND not disabled in settings_data.json
    const detail = detectEmbedState(content);
    return {
      live: detail === "active",
      themeName: mainTheme.name,
      themeId: mainTheme.id,
      detail,
      reason: null,
    };
  } catch (err) {
    console.error("theme-detection: request threw:", err);
    return { live: false, themeName: null, themeId: null, detail: "unknown", reason: "api_error" };
  }
}
