import { PrismaClient } from "@prisma/client";

declare global {
  var prismaGlobal: PrismaClient | undefined;
}

// Reuse the same client across hot-reloads in dev AND across warm invocations in production.
// Without this, every serverless cold-start (and every HMR cycle in dev) creates a new pool.
const prisma = global.prismaGlobal ?? (global.prismaGlobal = new PrismaClient());

export default prisma;
