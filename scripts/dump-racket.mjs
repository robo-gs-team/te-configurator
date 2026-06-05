import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const c = await prisma.configurator.findFirst({
  where: { name: "Test Racket" },
  include: {
    steps: {
      include: { optionGroups: { include: { options: true } } },
      orderBy: { sortOrder: "asc" },
    },
    addons: true,
  },
});
console.log(JSON.stringify(c, null, 2));
await prisma.$disconnect();
