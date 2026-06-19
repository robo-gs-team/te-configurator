-- Run this once in Supabase → SQL Editor → New query → Run
-- Creates all app tables and marks the Prisma migration as applied.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Shop" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Configurator" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "productIds" TEXT NOT NULL DEFAULT '[]',
    "collectionIds" TEXT NOT NULL DEFAULT '[]',
    "laborVariantId" TEXT,
    "laborPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "basePrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Configurator_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConfiguratorStep" (
    "id" TEXT NOT NULL,
    "configuratorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "stepType" TEXT NOT NULL DEFAULT 'variant',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ConfiguratorStep_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OptionGroup" (
    "id" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayType" TEXT NOT NULL DEFAULT 'swatch',
    "collectionIds" TEXT NOT NULL DEFAULT '[]',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "OptionGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Option" (
    "id" TEXT NOT NULL,
    "optionGroupId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "imageUrl" TEXT,
    "previewLayer" TEXT,
    "priceAdjust" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "variantId" TEXT,
    "productId" TEXT,
    "colorHex" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "metadata" TEXT NOT NULL DEFAULT '{}',

    CONSTRAINT "Option_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConditionalRule" (
    "id" TEXT NOT NULL,
    "configuratorId" TEXT NOT NULL,
    "name" TEXT,
    "conditionField" TEXT NOT NULL,
    "conditionOp" TEXT NOT NULL DEFAULT 'equals',
    "conditionValue" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "actionTarget" TEXT,
    "actionValue" TEXT NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ConditionalRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Addon" (
    "id" TEXT NOT NULL,
    "configuratorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "variantId" TEXT,
    "maxQuantity" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "metadata" TEXT NOT NULL DEFAULT '{}',

    CONSTRAINT "Addon_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ThemeSetting" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "buttonEnabled" BOOLEAN NOT NULL DEFAULT true,
    "buttonLabel" TEXT NOT NULL DEFAULT 'Customize Product',
    "buttonBgColor" TEXT NOT NULL DEFAULT '#111827',
    "buttonTextColor" TEXT NOT NULL DEFAULT '#ffffff',
    "buttonRadius" TEXT NOT NULL DEFAULT '12px',
    "buttonPosition" TEXT NOT NULL DEFAULT 'after_add_to_cart',
    "modalTheme" TEXT NOT NULL DEFAULT 'dark',
    "modalAccent" TEXT NOT NULL DEFAULT '#6366f1',
    "overlayBlur" INTEGER NOT NULL DEFAULT 12,
    "fontFamily" TEXT NOT NULL DEFAULT 'system-ui',
    "customCss" TEXT,

    CONSTRAINT "ThemeSetting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Analytics" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "configuratorId" TEXT,
    "eventType" TEXT NOT NULL,
    "productId" TEXT,
    "sessionId" TEXT,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Analytics_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SavedConfiguration" (
    "id" TEXT NOT NULL,
    "shareId" TEXT NOT NULL,
    "configuratorId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "selections" TEXT NOT NULL,
    "addons" TEXT NOT NULL DEFAULT '[]',
    "totalPrice" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "SavedConfiguration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Shop_domain_key" ON "Shop"("domain");
CREATE INDEX "Configurator_shopId_idx" ON "Configurator"("shopId");
CREATE INDEX "ConfiguratorStep_configuratorId_idx" ON "ConfiguratorStep"("configuratorId");
CREATE INDEX "OptionGroup_stepId_idx" ON "OptionGroup"("stepId");
CREATE INDEX "Option_optionGroupId_idx" ON "Option"("optionGroupId");
CREATE INDEX "ConditionalRule_configuratorId_idx" ON "ConditionalRule"("configuratorId");
CREATE INDEX "Addon_configuratorId_idx" ON "Addon"("configuratorId");
CREATE UNIQUE INDEX "ThemeSetting_shopId_key" ON "ThemeSetting"("shopId");
CREATE INDEX "Analytics_shopId_eventType_idx" ON "Analytics"("shopId", "eventType");
CREATE INDEX "Analytics_createdAt_idx" ON "Analytics"("createdAt");
CREATE UNIQUE INDEX "SavedConfiguration_shareId_key" ON "SavedConfiguration"("shareId");
CREATE INDEX "SavedConfiguration_shareId_idx" ON "SavedConfiguration"("shareId");
CREATE INDEX "SavedConfiguration_configuratorId_idx" ON "SavedConfiguration"("configuratorId");

ALTER TABLE "Configurator" ADD CONSTRAINT "Configurator_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConfiguratorStep" ADD CONSTRAINT "ConfiguratorStep_configuratorId_fkey" FOREIGN KEY ("configuratorId") REFERENCES "Configurator"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OptionGroup" ADD CONSTRAINT "OptionGroup_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "ConfiguratorStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Option" ADD CONSTRAINT "Option_optionGroupId_fkey" FOREIGN KEY ("optionGroupId") REFERENCES "OptionGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConditionalRule" ADD CONSTRAINT "ConditionalRule_configuratorId_fkey" FOREIGN KEY ("configuratorId") REFERENCES "Configurator"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Addon" ADD CONSTRAINT "Addon_configuratorId_fkey" FOREIGN KEY ("configuratorId") REFERENCES "Configurator"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ThemeSetting" ADD CONSTRAINT "ThemeSetting_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Analytics" ADD CONSTRAINT "Analytics_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tell Prisma this migration was already applied
CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id" VARCHAR(36) NOT NULL,
    "checksum" VARCHAR(64) NOT NULL,
    "finished_at" TIMESTAMPTZ,
    "migration_name" VARCHAR(255) NOT NULL,
    "logs" TEXT,
    "rolled_back_at" TIMESTAMPTZ,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "applied_steps_count" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "_prisma_migrations_pkey" PRIMARY KEY ("id")
);

INSERT INTO "_prisma_migrations" (
    "id",
    "checksum",
    "finished_at",
    "migration_name",
    "logs",
    "rolled_back_at",
    "started_at",
    "applied_steps_count"
) VALUES (
    gen_random_uuid()::text,
    '732f0bb871aa09bfa442cea14d7c287f0a2d59d635341fc764c346a62af19e60',
    NOW(),
    '20250605000000_init',
    NULL,
    NULL,
    NOW(),
    1
);
