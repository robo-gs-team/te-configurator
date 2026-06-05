import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const updated = await prisma.configurator.updateMany({
  where: {
    name: "Test Racket",
    shop: { domain: "gs-test-store-4.myshopify.com" },
  },
  data: { isActive: true },
});

console.log("Updated configurators:", updated.count);

await prisma.$disconnect();
