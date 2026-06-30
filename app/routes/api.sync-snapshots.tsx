import type { LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import prisma from "~/db.server";
import { getConfiguratorById } from "~/lib/configurator.server";
import { buildAndStoreSnapshot } from "~/lib/snapshot.server";
import { unauthenticated } from "~/shopify.server";

// Called daily by Vercel cron (vercel.json) and protected by CRON_SECRET.
// Re-syncs every active configurator's enriched snapshot so shopper data stays
// fresh even if Shopify product prices/images change without a merchant re-save.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await prisma.configurator.findMany({
    where: { isActive: true },
    select: {
      id: true,
      shopId: true,
      shop: { select: { domain: true } },
    },
  });

  let succeeded = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const { admin } = await unauthenticated.admin(row.shop.domain);
      const full = await getConfiguratorById(row.id);
      if (!full) continue;
      await buildAndStoreSnapshot(admin, full, row.shopId);
      succeeded++;
    } catch (err) {
      console.error(`Snapshot sync failed for configurator ${row.id}:`, err);
      failed++;
    }
  }

  return json({ ok: true, total: rows.length, succeeded, failed });
};
