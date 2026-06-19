-- AlterTable
ALTER TABLE "Configurator" ADD COLUMN "laborVariantId" TEXT;
ALTER TABLE "Configurator" ADD COLUMN "laborPrice" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "OptionGroup" ADD COLUMN "collectionIds" TEXT NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "Option" ADD COLUMN "productId" TEXT;
