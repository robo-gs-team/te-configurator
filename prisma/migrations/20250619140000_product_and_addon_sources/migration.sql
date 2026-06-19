-- AlterTable
ALTER TABLE "OptionGroup" ADD COLUMN "productIds" TEXT NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "Addon" ADD COLUMN "productIds" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "Addon" ADD COLUMN "collectionIds" TEXT NOT NULL DEFAULT '[]';
