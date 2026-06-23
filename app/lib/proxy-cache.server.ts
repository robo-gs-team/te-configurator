type CachedEntry = { data: unknown; expires: number };

const cache = new Map<string, CachedEntry>();
const TTL_MS = 5 * 60 * 1000; // 5 minutes — configurator data changes only on merchant save

export function getCachedProxyResponse(shopDomain: string, productId: string): unknown | null {
  const key = `${shopDomain}:${productId}`;
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expires <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit.data;
}

export function setCachedProxyResponse(
  shopDomain: string,
  productId: string,
  data: unknown,
): void {
  cache.set(`${shopDomain}:${productId}`, { data, expires: Date.now() + TTL_MS });
}

// Call this from the admin action whenever a configurator is saved
export function invalidateProxyCache(shopDomain: string): void {
  const prefix = `${shopDomain}:`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}
