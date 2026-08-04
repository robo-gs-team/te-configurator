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
  const secret = process.env.CRON_SECRET?.trim();
  const authHeader = request.headers.get("authorization");

  // Distinguish "misconfigured" from "rejected". Both must still return 401 — never leak which
  // one to a caller — but they need very different fixes, and collapsing them into one silent
  // response is how this job sat dead for weeks: Vercel fired it nightly, the endpoint rejected
  // every call because CRON_SECRET was unset, and nothing anywhere said so. Snapshots then only
  // rebuilt on merchant save, and any configurator never saved since its creation served every
  // PDP through slow live enrichment.
  if (!secret) {
    console.error(
      "[sync-snapshots] CRON_SECRET is not set — the nightly snapshot refresh CANNOT run. " +
        "Set it in the Vercel project's environment variables and redeploy; /healthz reports " +
        "whether the running deployment can see it.",
    );
    return json({ error: "Unauthorized" }, { status: 401 });
  }
  if (authHeader !== `Bearer ${secret}`) {
    console.error(
      "[sync-snapshots] Rejected a request with a missing or mismatched bearer token. If this " +
        "is the Vercel cron, CRON_SECRET was changed without redeploying.",
    );
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

  // Group by shop so we authenticate once per shop instead of once per configurator.
  type ShopGroup = { domain: string; ids: string[] };
  const byShop = new Map<string, ShopGroup>();
  for (const row of rows) {
    const entry: ShopGroup =
      byShop.get(row.shopId) ?? { domain: row.shop.domain, ids: [] };
    entry.ids.push(row.id);
    byShop.set(row.shopId, entry);
  }

  let succeeded = 0;
  let failed = 0;
  const CONCURRENCY = 5;

  for (const [shopId, { domain, ids }] of byShop) {
    let admin: Awaited<ReturnType<typeof unauthenticated.admin>>["admin"];
    try {
      admin = (await unauthenticated.admin(domain)).admin;
    } catch (err) {
      // Whole shop unreachable (uninstalled/expired session) — skip its configurators.
      console.error(`Snapshot sync: auth failed for shop ${domain}:`, err);
      failed += ids.length;
      continue;
    }

    // Rebuild this shop's snapshots in bounded-concurrency batches to stay under the
    // function timeout while not hammering the Admin API all at once.
    for (let i = 0; i < ids.length; i += CONCURRENCY) {
      const batch = ids.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (id) => {
          const full = await getConfiguratorById(id);
          if (!full) return;
          // Nightly run: refresh the best-seller (units-sold, last 60d) tally from Shopify orders.
          // Merchant saves carry the previous tally forward instead, so this daily job is the one
          // place that actually scans orders.
          await buildAndStoreSnapshot(admin, full, shopId, { refreshSales: true });
        }),
      );
      for (const r of results) {
        if (r.status === "fulfilled") succeeded++;
        else {
          failed++;
          console.error("Snapshot sync failed for a configurator:", r.reason);
        }
      }
    }
  }

  return json({ ok: true, total: rows.length, succeeded, failed });
};
