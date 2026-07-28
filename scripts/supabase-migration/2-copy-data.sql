-- ============================================================================
-- STEP 2 of 2 — copy the DATA from the OLD (Sydney) project into this NEW one.
--
-- WHERE: NEW project -> SQL Editor -> paste -> edit the connection string on the
--        line marked CHANGE ME -> Run.
--
-- HOW IT WORKS: dblink lets this database open a connection to the old one and
-- SELECT straight out of it, so nothing has to be downloaded and re-uploaded.
--
-- BEFORE RUNNING: replace the placeholder below with the OLD project's
-- Session pooler (port 5432) connection string, password included.
-- Get it from: old project -> Connect -> Session pooler.
--
-- SAFE TO RE-RUN: every copy uses ON CONFLICT DO NOTHING.
-- ORDER MATTERS: parents before children, so foreign keys hold throughout.
-- ============================================================================

create extension if not exists dblink;

-- ---------------------------------------------------------------- CHANGE ME
-- Replace ONLY the string inside the quotes.
create or replace function _old_db() returns text language sql immutable as $$
  select 'postgresql://postgres.OLDREF:OLDPASSWORD@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres'
$$;
-- ---------------------------------------------------------------------------


-- Session
insert into "Session" ("id", "shop", "state", "isOnline", "scope", "expires", "accessToken", "userId", "firstName", "lastName", "email", "accountOwner", "locale", "collaborator", "emailVerified", "refreshToken", "refreshTokenExpires")
select "id", "shop", "state", "isOnline", "scope", "expires", "accessToken", "userId", "firstName", "lastName", "email", "accountOwner", "locale", "collaborator", "emailVerified", "refreshToken", "refreshTokenExpires" from dblink(_old_db(), 'select "id", "shop", "state", "isOnline", "scope", "expires", "accessToken", "userId", "firstName", "lastName", "email", "accountOwner", "locale", "collaborator", "emailVerified", "refreshToken", "refreshTokenExpires" from "Session"')
  as t("id" text, "shop" text, "state" text, "isOnline" boolean, "scope" text, "expires" timestamp(3), "accessToken" text, "userId" bigint, "firstName" text, "lastName" text, "email" text, "accountOwner" boolean, "locale" text, "collaborator" boolean, "emailVerified" boolean, "refreshToken" text, "refreshTokenExpires" timestamp(3))
on conflict do nothing;

-- Shop
insert into "Shop" ("id", "domain", "name", "createdAt", "updatedAt")
select "id", "domain", "name", "createdAt", "updatedAt" from dblink(_old_db(), 'select "id", "domain", "name", "createdAt", "updatedAt" from "Shop"')
  as t("id" text, "domain" text, "name" text, "createdAt" timestamp(3), "updatedAt" timestamp(3))
on conflict do nothing;

-- Configurator
insert into "Configurator" ("id", "shopId", "name", "description", "isActive", "productIds", "collectionIds", "stringCollectionIds", "stringProductIds", "excludedProductIds", "allowOutOfStock", "allowOutOfStockRacquets", "allowOutOfStockStrings", "inventoryPolicyBackup", "hideOutOfStockStrings", "laborVariantId", "laborPrice", "basePrice", "currency", "enrichedSnapshot", "snapshotUpdatedAt", "createdAt", "updatedAt")
select "id", "shopId", "name", "description", "isActive", "productIds", "collectionIds", "stringCollectionIds", "stringProductIds", "excludedProductIds", "allowOutOfStock", "allowOutOfStockRacquets", "allowOutOfStockStrings", "inventoryPolicyBackup", "hideOutOfStockStrings", "laborVariantId", "laborPrice", "basePrice", "currency", "enrichedSnapshot", "snapshotUpdatedAt", "createdAt", "updatedAt" from dblink(_old_db(), 'select "id", "shopId", "name", "description", "isActive", "productIds", "collectionIds", "stringCollectionIds", "stringProductIds", "excludedProductIds", "allowOutOfStock", "allowOutOfStockRacquets", "allowOutOfStockStrings", "inventoryPolicyBackup", "hideOutOfStockStrings", "laborVariantId", "laborPrice", "basePrice", "currency", "enrichedSnapshot", "snapshotUpdatedAt", "createdAt", "updatedAt" from "Configurator"')
  as t("id" text, "shopId" text, "name" text, "description" text, "isActive" boolean, "productIds" text, "collectionIds" text, "stringCollectionIds" text, "stringProductIds" text, "excludedProductIds" text, "allowOutOfStock" boolean, "allowOutOfStockRacquets" boolean, "allowOutOfStockStrings" boolean, "inventoryPolicyBackup" text, "hideOutOfStockStrings" boolean, "laborVariantId" text, "laborPrice" double precision, "basePrice" double precision, "currency" text, "enrichedSnapshot" text, "snapshotUpdatedAt" timestamp(3), "createdAt" timestamp(3), "updatedAt" timestamp(3))
on conflict do nothing;

-- ConfiguratorStep
insert into "ConfiguratorStep" ("id", "configuratorId", "title", "description", "stepType", "sortOrder", "isRequired")
select "id", "configuratorId", "title", "description", "stepType", "sortOrder", "isRequired" from dblink(_old_db(), 'select "id", "configuratorId", "title", "description", "stepType", "sortOrder", "isRequired" from "ConfiguratorStep"')
  as t("id" text, "configuratorId" text, "title" text, "description" text, "stepType" text, "sortOrder" integer, "isRequired" boolean)
on conflict do nothing;

-- OptionGroup
insert into "OptionGroup" ("id", "stepId", "name", "displayType", "collectionIds", "productIds", "sortOrder", "isRequired")
select "id", "stepId", "name", "displayType", "collectionIds", "productIds", "sortOrder", "isRequired" from dblink(_old_db(), 'select "id", "stepId", "name", "displayType", "collectionIds", "productIds", "sortOrder", "isRequired" from "OptionGroup"')
  as t("id" text, "stepId" text, "name" text, "displayType" text, "collectionIds" text, "productIds" text, "sortOrder" integer, "isRequired" boolean)
on conflict do nothing;

-- Option
insert into "Option" ("id", "optionGroupId", "label", "value", "imageUrl", "previewLayer", "priceAdjust", "variantId", "productId", "colorHex", "sortOrder", "isDefault", "metadata")
select "id", "optionGroupId", "label", "value", "imageUrl", "previewLayer", "priceAdjust", "variantId", "productId", "colorHex", "sortOrder", "isDefault", "metadata" from dblink(_old_db(), 'select "id", "optionGroupId", "label", "value", "imageUrl", "previewLayer", "priceAdjust", "variantId", "productId", "colorHex", "sortOrder", "isDefault", "metadata" from "Option"')
  as t("id" text, "optionGroupId" text, "label" text, "value" text, "imageUrl" text, "previewLayer" text, "priceAdjust" double precision, "variantId" text, "productId" text, "colorHex" text, "sortOrder" integer, "isDefault" boolean, "metadata" text)
on conflict do nothing;

-- ConditionalRule
insert into "ConditionalRule" ("id", "configuratorId", "name", "conditionField", "conditionOp", "conditionValue", "actionType", "actionTarget", "actionValue", "isActive", "sortOrder")
select "id", "configuratorId", "name", "conditionField", "conditionOp", "conditionValue", "actionType", "actionTarget", "actionValue", "isActive", "sortOrder" from dblink(_old_db(), 'select "id", "configuratorId", "name", "conditionField", "conditionOp", "conditionValue", "actionType", "actionTarget", "actionValue", "isActive", "sortOrder" from "ConditionalRule"')
  as t("id" text, "configuratorId" text, "name" text, "conditionField" text, "conditionOp" text, "conditionValue" text, "actionType" text, "actionTarget" text, "actionValue" text, "isActive" boolean, "sortOrder" integer)
on conflict do nothing;

-- Addon
insert into "Addon" ("id", "configuratorId", "name", "description", "imageUrl", "price", "variantId", "productIds", "collectionIds", "maxQuantity", "isActive", "sortOrder", "metadata")
select "id", "configuratorId", "name", "description", "imageUrl", "price", "variantId", "productIds", "collectionIds", "maxQuantity", "isActive", "sortOrder", "metadata" from dblink(_old_db(), 'select "id", "configuratorId", "name", "description", "imageUrl", "price", "variantId", "productIds", "collectionIds", "maxQuantity", "isActive", "sortOrder", "metadata" from "Addon"')
  as t("id" text, "configuratorId" text, "name" text, "description" text, "imageUrl" text, "price" double precision, "variantId" text, "productIds" text, "collectionIds" text, "maxQuantity" integer, "isActive" boolean, "sortOrder" integer, "metadata" text)
on conflict do nothing;

-- ThemeSetting
insert into "ThemeSetting" ("id", "shopId", "buttonEnabled", "buttonLabel", "buttonBgColor", "buttonTextColor", "buttonRadius", "buttonPosition", "modalTheme", "modalAccent", "overlayBlur", "fontFamily", "mobileStringCount", "customCss")
select "id", "shopId", "buttonEnabled", "buttonLabel", "buttonBgColor", "buttonTextColor", "buttonRadius", "buttonPosition", "modalTheme", "modalAccent", "overlayBlur", "fontFamily", "mobileStringCount", "customCss" from dblink(_old_db(), 'select "id", "shopId", "buttonEnabled", "buttonLabel", "buttonBgColor", "buttonTextColor", "buttonRadius", "buttonPosition", "modalTheme", "modalAccent", "overlayBlur", "fontFamily", "mobileStringCount", "customCss" from "ThemeSetting"')
  as t("id" text, "shopId" text, "buttonEnabled" boolean, "buttonLabel" text, "buttonBgColor" text, "buttonTextColor" text, "buttonRadius" text, "buttonPosition" text, "modalTheme" text, "modalAccent" text, "overlayBlur" integer, "fontFamily" text, "mobileStringCount" integer, "customCss" text)
on conflict do nothing;

-- Analytics
insert into "Analytics" ("id", "shopId", "configuratorId", "eventType", "productId", "sessionId", "metadata", "createdAt")
select "id", "shopId", "configuratorId", "eventType", "productId", "sessionId", "metadata", "createdAt" from dblink(_old_db(), 'select "id", "shopId", "configuratorId", "eventType", "productId", "sessionId", "metadata", "createdAt" from "Analytics"')
  as t("id" text, "shopId" text, "configuratorId" text, "eventType" text, "productId" text, "sessionId" text, "metadata" text, "createdAt" timestamp(3))
on conflict do nothing;

-- SavedConfiguration
insert into "SavedConfiguration" ("id", "shareId", "configuratorId", "productId", "selections", "addons", "totalPrice", "createdAt", "expiresAt")
select "id", "shareId", "configuratorId", "productId", "selections", "addons", "totalPrice", "createdAt", "expiresAt" from dblink(_old_db(), 'select "id", "shareId", "configuratorId", "productId", "selections", "addons", "totalPrice", "createdAt", "expiresAt" from "SavedConfiguration"')
  as t("id" text, "shareId" text, "configuratorId" text, "productId" text, "selections" text, "addons" text, "totalPrice" double precision, "createdAt" timestamp(3), "expiresAt" timestamp(3))
on conflict do nothing;


-- Prisma's own bookkeeping table, so future `prisma migrate deploy` runs know
-- these migrations are already applied and don't try to re-run them.
insert into "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
select id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count
from dblink(_old_db(), 'select id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count from "_prisma_migrations"')
  as t(id text, checksum text, finished_at timestamptz, migration_name text, logs text,
       rolled_back_at timestamptz, started_at timestamptz, applied_steps_count integer)
on conflict do nothing;

drop function _old_db();

-- ============================================================================
-- VERIFY — row counts should match the old project.
-- ============================================================================
select 'Session' t, count(*) from "Session"
union all select 'Shop', count(*) from "Shop"
union all select 'Configurator', count(*) from "Configurator"
union all select 'ConfiguratorStep', count(*) from "ConfiguratorStep"
union all select 'OptionGroup', count(*) from "OptionGroup"
union all select 'Option', count(*) from "Option"
union all select 'ConditionalRule', count(*) from "ConditionalRule"
union all select 'Addon', count(*) from "Addon"
union all select 'ThemeSetting', count(*) from "ThemeSetting"
union all select 'Analytics', count(*) from "Analytics"
union all select 'SavedConfiguration', count(*) from "SavedConfiguration"
order by 1;