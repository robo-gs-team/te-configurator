import { APP_CLIENT_ID, EMBED_HANDLE, EXTENSION_UUID } from "~/lib/theme-embed";

type ShopifyAdmin = {
  graphql: (
    query: string,
    opts?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

/** One theme and whether our app embed is enabled (present + not disabled) in it. */
export type ThemeEmbedInfo = {
  id: string;
  name: string;
  role: string; // "MAIN" (published) | "DEVELOPMENT" | "UNPUBLISHED" | "DEMO" | ...
  on: boolean;
};

export type AppEmbedStatus = {
  ok: boolean; // detection ran successfully (themes readable)
  // The published theme's embed state, or null when it couldn't be determined.
  live: ThemeEmbedInfo | null;
  // Non-published themes we scanned where the embed is ON (draft/dev themes — e.g. the Beta test
  // theme). Only from the scanned set (see `scanned`/`total`), most-recently-updated first.
  otherOn: ThemeEmbedInfo[];
  scanned: number; // how many themes we read settings for
  total: number; // total themes on the store
  reason:
    | "missing_theme_scope"
    | "no_themes"
    | "api_error"
    | "graphql_error"
    | null;
};

// How many themes' settings_data.json we read per dashboard load. The published theme is always
// read; the rest of the budget goes to the most-recently-updated themes (the one a merchant is
// actively testing on is almost always recently touched). Bounded so a store with dozens of theme
// copies can't fan out into dozens of Admin API calls on every dashboard view.
const MAX_SETTINGS_READS = 10;

// Two+ live Admin API round-trips on every dashboard view was a cause of slow admin navigation.
// The embed toggle changes rarely, so a short cache trades a little staleness for near-instant
// repeat loads — same tradeoff as the storefront proxy cache.
const statusCache = new Map<string, { data: AppEmbedStatus; expires: number }>();
const STATUS_TTL_MS = 60 * 1000;

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
 * Determine our app embed's state from a theme's settings_data.json. App embeds live under
 * `current.blocks`; a toggled-off embed keeps its entry but with `disabled: true`. So presence
 * alone is NOT "on" — we must find our block AND confirm it isn't disabled. Falls back to a
 * substring check only if the JSON can't be parsed.
 */
function detectEmbedOn(content: string): boolean {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    return (
      content.includes(EXTENSION_UUID) ||
      content.includes(APP_CLIENT_ID) ||
      content.includes(EMBED_HANDLE)
    );
  }

  const root = data as { current?: unknown; blocks?: unknown };
  const current = root?.current as { blocks?: unknown } | undefined;
  const containers = [current?.blocks, root?.blocks].filter(
    (b): b is Record<string, SettingsBlock> => Boolean(b) && typeof b === "object",
  );

  for (const blocks of containers) {
    for (const [key, block] of Object.entries(blocks)) {
      if (blockMatchesOurEmbed(key, block)) {
        return block?.disabled !== true;
      }
    }
  }
  return false;
}

// A GraphQL errors array mentioning access/permission/scope means the token can't read themes —
// almost always because read_themes was added after install, so the merchant must re-authorize.
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

/** Read one theme's settings_data.json and detect the embed state. Errors → off (best-effort). */
async function readThemeEmbed(
  admin: ShopifyAdmin,
  theme: { id: string; name: string; role: string },
): Promise<ThemeEmbedInfo> {
  try {
    const res = await admin.graphql(
      `
      #graphql
      query GetThemeFile($id: ID!) {
        theme(id: $id) {
          files(filenames: ["config/settings_data.json"]) {
            nodes { body { ... on OnlineStoreThemeFileBodyText { content } } }
          }
        }
      }
    `,
      { variables: { id: theme.id } },
    );
    const json = (await res.json()) as {
      data?: { theme?: { files?: { nodes?: Array<{ body?: { content?: string } }> } } };
    };
    const content = json.data?.theme?.files?.nodes?.[0]?.body?.content;
    return {
      id: theme.id,
      name: theme.name,
      role: theme.role,
      on: content ? detectEmbedOn(content) : false,
    };
  } catch {
    return { id: theme.id, name: theme.name, role: theme.role, on: false };
  }
}

export async function detectAppEmbedStatus(
  admin: ShopifyAdmin,
  shopDomain: string,
): Promise<AppEmbedStatus> {
  const cached = statusCache.get(shopDomain);
  if (cached && cached.expires > Date.now()) return cached.data;

  const result = await fetchAppEmbedStatus(admin);
  statusCache.set(shopDomain, { data: result, expires: Date.now() + STATUS_TTL_MS });
  return result;
}

async function fetchAppEmbedStatus(admin: ShopifyAdmin): Promise<AppEmbedStatus> {
  const base: AppEmbedStatus = {
    ok: false,
    live: null,
    otherOn: [],
    scanned: 0,
    total: 0,
    reason: null,
  };
  try {
    // first:50 (up from 10) so the published theme is found even on stores with many theme copies
    // — a store with >10 themes pushed MAIN out of the window and produced a false "no published
    // theme". updatedAt lets us prioritize which drafts to scan for the "also on" list.
    const res = await admin.graphql(`
      #graphql
      query {
        themes(first: 50) {
          nodes { id name role updatedAt }
        }
      }
    `);
    const json = (await res.json()) as {
      data?: {
        themes?: { nodes?: Array<{ id: string; name: string; role: string; updatedAt: string }> };
      };
      errors?: unknown;
    };

    if (json.errors) {
      console.error("theme-detection: themes query errors:", JSON.stringify(json.errors));
      return {
        ...base,
        reason: looksLikeScopeError(json.errors) ? "missing_theme_scope" : "graphql_error",
      };
    }

    const themes = json.data?.themes?.nodes ?? [];
    if (themes.length === 0) return { ...base, reason: "no_themes" };

    const mainTheme = themes.find((t) => t.role === "MAIN") ?? null;
    const others = themes
      .filter((t) => t.role !== "MAIN")
      .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));

    // Always read the published theme; spend the rest of the budget on most-recently-updated others.
    const toRead = [
      ...(mainTheme ? [mainTheme] : []),
      ...others.slice(0, Math.max(0, MAX_SETTINGS_READS - (mainTheme ? 1 : 0))),
    ];
    const infos = await Promise.all(toRead.map((t) => readThemeEmbed(admin, t)));

    const live = infos.find((t) => t.role === "MAIN") ?? null;
    const otherOn = infos.filter((t) => t.role !== "MAIN" && t.on);

    return {
      ok: true,
      live,
      otherOn,
      scanned: infos.length,
      total: themes.length,
      reason: null,
    };
  } catch (err) {
    console.error("theme-detection: request threw:", err);
    return { ...base, reason: "api_error" };
  }
}
