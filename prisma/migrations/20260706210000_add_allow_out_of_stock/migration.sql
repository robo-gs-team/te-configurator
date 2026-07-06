-- Per-configurator toggle: allow ordering linked racquets while out of stock (sets variant
-- inventoryPolicy to CONTINUE on Shopify when enabled).
ALTER TABLE "Configurator" ADD COLUMN "allowOutOfStock" BOOLEAN NOT NULL DEFAULT false;
