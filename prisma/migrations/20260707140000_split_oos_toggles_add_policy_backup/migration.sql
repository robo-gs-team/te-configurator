-- Split the single out-of-stock override into separate racquet/string toggles, seeding both from
-- the existing value so current behavior is preserved. Add a per-variant policy backup used for a
-- non-destructive revert.
ALTER TABLE "Configurator" ADD COLUMN "allowOutOfStockRacquets" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Configurator" ADD COLUMN "allowOutOfStockStrings" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Configurator" ADD COLUMN "inventoryPolicyBackup" TEXT NOT NULL DEFAULT '{}';

UPDATE "Configurator"
  SET "allowOutOfStockRacquets" = "allowOutOfStock",
      "allowOutOfStockStrings" = "allowOutOfStock";
