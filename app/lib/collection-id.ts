/** Normalize Shopify collection IDs (numeric, GID, or admin URL fragments). */
export function normalizeCollectionId(id: string): string {
  const trimmed = String(id).trim();
  const gidMatch = trimmed.match(/Collection\/(\d+)/i);
  if (gidMatch) return gidMatch[1];
  const digits = trimmed.match(/(\d{3,})/);
  return digits ? digits[1] : trimmed;
}

export function toCollectionGid(id: string): string {
  const numeric = normalizeCollectionId(id);
  return `gid://shopify/Collection/${numeric}`;
}

export function parseCollectionIdsField(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((id) => normalizeCollectionId(String(id))).filter(Boolean);
      }
    } catch {
      // fall through to comma-separated parsing
    }
  }

  return trimmed
    .split(",")
    .map((id) => normalizeCollectionId(id))
    .filter(Boolean);
}
