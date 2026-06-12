/** Normalize Shopify product IDs (numeric, GID, or admin URL fragments). */
export function normalizeProductId(id: string): string {
  const trimmed = String(id).trim();
  const gidMatch = trimmed.match(/Product\/(\d+)/i);
  if (gidMatch) return gidMatch[1];
  const digits = trimmed.match(/(\d{5,})/);
  return digits ? digits[1] : trimmed;
}

export function toProductGid(id: string): string {
  return `gid://shopify/Product/${normalizeProductId(id)}`;
}

export function productIdsMatch(storedIds: string[], productId: string): boolean {
  const target = normalizeProductId(productId);
  return storedIds.some((stored) => normalizeProductId(String(stored)) === target);
}

export function parseProductIdsField(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((id) => normalizeProductId(String(id))).filter(Boolean);
      }
    } catch {
      // fall through to comma-separated parsing
    }
  }

  return trimmed
    .split(",")
    .map((id) => normalizeProductId(id))
    .filter(Boolean);
}
