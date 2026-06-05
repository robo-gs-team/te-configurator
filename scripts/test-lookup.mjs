import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function normalizeProductId(id) {
  const trimmed = String(id).trim();
  const gidMatch = trimmed.match(/Product\/(\d+)/i);
  if (gidMatch) return gidMatch[1];
  const digits = trimmed.match(/(\d{5,})/);
  return digits ? digits[1] : trimmed;
}

function productIdsMatch(storedIds, productId) {
  const target = normalizeProductId(productId);
  return storedIds.some((stored) => normalizeProductId(String(stored)) === target);
}

const shop = await prisma.shop.findUnique({
  where: { domain: "gs-test-store-4.myshopify.com" },
});

const configurators = await prisma.configurator.findMany({
  where: { shopId: shop.id },
});

for (const id of ["10139144618274", "10139144618274.0", "gid://shopify/Product/10139144618274"]) {
  const match = configurators.find((c) =>
    productIdsMatch(JSON.parse(c.productIds || "[]"), id),
  );
  console.log(id, "->", match ? `${match.name} active=${match.isActive}` : "NO MATCH");
}

await prisma.$disconnect();
