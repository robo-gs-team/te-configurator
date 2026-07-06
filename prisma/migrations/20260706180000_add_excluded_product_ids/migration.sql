-- Products to exclude from the configurator (string options + racquet button eligibility).
ALTER TABLE "Configurator" ADD COLUMN "excludedProductIds" TEXT NOT NULL DEFAULT '[]';
