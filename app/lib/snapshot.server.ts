import prisma from "~/db.server";
import { enrichConfiguratorWithShopifyData } from "~/lib/enrich-configurator.server";
import { getShopThemeSettings } from "~/lib/configurator.server";
import { serializeConfiguratorPayload } from "~/lib/configurator.types";
import type { ConfiguratorWithRelations } from "~/lib/configurator.types";

type ShopifyAdmin = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export async function buildAndStoreSnapshot(
  admin: ShopifyAdmin,
  configurator: ConfiguratorWithRelations,
  shopId: string,
): Promise<void> {
  const [enriched, theme] = await Promise.all([
    enrichConfiguratorWithShopifyData(admin, configurator),
    getShopThemeSettings(shopId),
  ]);

  const payload = { configurator: serializeConfiguratorPayload(enriched, theme) };

  await prisma.configurator.update({
    where: { id: configurator.id },
    data: {
      enrichedSnapshot: JSON.stringify(payload),
      snapshotUpdatedAt: new Date(),
    } as Parameters<typeof prisma.configurator.update>[0]["data"],
  });
}
