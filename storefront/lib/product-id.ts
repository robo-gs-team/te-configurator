export function normalizeProductId(id: string): string {
  const trimmed = String(id).trim();
  const gidMatch = trimmed.match(/Product\/(\d+)/i);
  if (gidMatch) return gidMatch[1];
  const digits = trimmed.match(/(\d{5,})/);
  return digits ? digits[1] : trimmed;
}
