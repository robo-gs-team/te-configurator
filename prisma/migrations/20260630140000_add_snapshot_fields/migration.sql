-- B1: write-time enrichment snapshot fields
ALTER TABLE "Configurator" ADD COLUMN "enrichedSnapshot" TEXT;
ALTER TABLE "Configurator" ADD COLUMN "snapshotUpdatedAt" TIMESTAMP(3);
