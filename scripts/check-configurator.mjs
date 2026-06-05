import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const shops = await prisma.shop.findMany({
  include: {
    configurators: {
      include: { steps: { select: { id: true, title: true } } },
    },
  },
});

console.log(JSON.stringify(shops, null, 2));

await prisma.$disconnect();
