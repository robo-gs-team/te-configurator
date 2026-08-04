-- Run this in the NEW (US) project's SQL Editor AFTER schema exists.
-- Copies all app data from the OLD (Sydney) project via dblink.
-- Uses named columns (not SELECT *) so differing physical column order is safe.
--
-- 1. Paste the OLD project's Session pooler URI below (port 5432).
-- 2. Replace the whole CHANGE ME value — keep the single quotes.
-- 3. Run. If dblink is blocked, use scripts/migrate-database.mjs instead.

CREATE EXTENSION IF NOT EXISTS dblink;

-- ============================================================================
-- CHANGE ME: OLD (Sydney) Session pooler connection string (port 5432)
-- ============================================================================
DO $$
DECLARE
  old_conn text := 'CHANGE ME';
BEGIN
  IF old_conn = 'CHANGE ME' OR old_conn IS NULL OR length(trim(old_conn)) = 0 THEN
    RAISE EXCEPTION 'Paste the OLD Sydney Session pooler connection string into old_conn (see CHANGE ME).';
  END IF;

  INSERT INTO "Session" (
    id, shop, state, "isOnline", scope, expires, "accessToken", "userId",
    "firstName", "lastName", email, "accountOwner", locale, collaborator,
    "emailVerified", "refreshToken", "refreshTokenExpires"
  )
  SELECT * FROM dblink(old_conn, $q$
    SELECT id, shop, state, "isOnline", scope, expires, "accessToken", "userId",
           "firstName", "lastName", email, "accountOwner", locale, collaborator,
           "emailVerified", "refreshToken", "refreshTokenExpires"
    FROM "Session"
  $q$) AS t(
    id text, shop text, state text, "isOnline" boolean, scope text, expires timestamp(3),
    "accessToken" text, "userId" bigint, "firstName" text, "lastName" text, email text,
    "accountOwner" boolean, locale text, collaborator boolean, "emailVerified" boolean,
    "refreshToken" text, "refreshTokenExpires" timestamp(3)
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO "Shop" (id, domain, name, "createdAt", "updatedAt")
  SELECT * FROM dblink(old_conn, $q$
    SELECT id, domain, name, "createdAt", "updatedAt" FROM "Shop"
  $q$) AS t(
    id text, domain text, name text, "createdAt" timestamp(3), "updatedAt" timestamp(3)
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO "Configurator" (
    id, "shopId", name, description, "isActive",
    "productIds", "collectionIds", "stringCollectionIds", "stringProductIds",
    "excludedProductIds", "allowOutOfStock", "allowOutOfStockRacquets",
    "allowOutOfStockStrings", "inventoryPolicyBackup", "hideOutOfStockStrings",
    "laborVariantId", "laborPrice", "basePrice", currency,
    "enrichedSnapshot", "snapshotUpdatedAt", "createdAt", "updatedAt"
  )
  SELECT * FROM dblink(old_conn, $q$
    SELECT id, "shopId", name, description, "isActive",
           "productIds", "collectionIds", "stringCollectionIds", "stringProductIds",
           "excludedProductIds", "allowOutOfStock", "allowOutOfStockRacquets",
           "allowOutOfStockStrings", "inventoryPolicyBackup", "hideOutOfStockStrings",
           "laborVariantId", "laborPrice", "basePrice", currency,
           "enrichedSnapshot", "snapshotUpdatedAt", "createdAt", "updatedAt"
    FROM "Configurator"
  $q$) AS t(
    id text, "shopId" text, name text, description text, "isActive" boolean,
    "productIds" text, "collectionIds" text, "stringCollectionIds" text, "stringProductIds" text,
    "excludedProductIds" text, "allowOutOfStock" boolean, "allowOutOfStockRacquets" boolean,
    "allowOutOfStockStrings" boolean, "inventoryPolicyBackup" text, "hideOutOfStockStrings" boolean,
    "laborVariantId" text, "laborPrice" double precision, "basePrice" double precision,
    currency text, "enrichedSnapshot" text, "snapshotUpdatedAt" timestamp(3),
    "createdAt" timestamp(3), "updatedAt" timestamp(3)
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO "ConfiguratorStep" (
    id, "configuratorId", title, description, "stepType", "sortOrder", "isRequired"
  )
  SELECT * FROM dblink(old_conn, $q$
    SELECT id, "configuratorId", title, description, "stepType", "sortOrder", "isRequired"
    FROM "ConfiguratorStep"
  $q$) AS t(
    id text, "configuratorId" text, title text, description text, "stepType" text,
    "sortOrder" integer, "isRequired" boolean
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO "OptionGroup" (
    id, "stepId", name, "displayType", "collectionIds", "productIds", "sortOrder", "isRequired"
  )
  SELECT * FROM dblink(old_conn, $q$
    SELECT id, "stepId", name, "displayType", "collectionIds", "productIds", "sortOrder", "isRequired"
    FROM "OptionGroup"
  $q$) AS t(
    id text, "stepId" text, name text, "displayType" text, "collectionIds" text,
    "productIds" text, "sortOrder" integer, "isRequired" boolean
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO "Option" (
    id, "optionGroupId", label, value, "imageUrl", "previewLayer", "priceAdjust",
    "variantId", "productId", "colorHex", "sortOrder", "isDefault", metadata
  )
  SELECT * FROM dblink(old_conn, $q$
    SELECT id, "optionGroupId", label, value, "imageUrl", "previewLayer", "priceAdjust",
           "variantId", "productId", "colorHex", "sortOrder", "isDefault", metadata
    FROM "Option"
  $q$) AS t(
    id text, "optionGroupId" text, label text, value text, "imageUrl" text,
    "previewLayer" text, "priceAdjust" double precision, "variantId" text, "productId" text,
    "colorHex" text, "sortOrder" integer, "isDefault" boolean, metadata text
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO "ConditionalRule" (
    id, "configuratorId", name, "conditionField", "conditionOp", "conditionValue",
    "actionType", "actionTarget", "actionValue", "isActive", "sortOrder"
  )
  SELECT * FROM dblink(old_conn, $q$
    SELECT id, "configuratorId", name, "conditionField", "conditionOp", "conditionValue",
           "actionType", "actionTarget", "actionValue", "isActive", "sortOrder"
    FROM "ConditionalRule"
  $q$) AS t(
    id text, "configuratorId" text, name text, "conditionField" text, "conditionOp" text,
    "conditionValue" text, "actionType" text, "actionTarget" text, "actionValue" text,
    "isActive" boolean, "sortOrder" integer
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO "Addon" (
    id, "configuratorId", name, description, "imageUrl", price, "variantId",
    "productIds", "collectionIds", "maxQuantity", "isActive", "sortOrder", metadata
  )
  SELECT * FROM dblink(old_conn, $q$
    SELECT id, "configuratorId", name, description, "imageUrl", price, "variantId",
           "productIds", "collectionIds", "maxQuantity", "isActive", "sortOrder", metadata
    FROM "Addon"
  $q$) AS t(
    id text, "configuratorId" text, name text, description text, "imageUrl" text,
    price double precision, "variantId" text, "productIds" text, "collectionIds" text,
    "maxQuantity" integer, "isActive" boolean, "sortOrder" integer, metadata text
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO "ThemeSetting" (
    id, "shopId", "buttonEnabled", "buttonLabel", "buttonBgColor", "buttonTextColor",
    "buttonRadius", "buttonPosition", "modalTheme", "modalAccent", "overlayBlur",
    "fontFamily", "mobileStringCount", "customCss"
  )
  SELECT * FROM dblink(old_conn, $q$
    SELECT id, "shopId", "buttonEnabled", "buttonLabel", "buttonBgColor", "buttonTextColor",
           "buttonRadius", "buttonPosition", "modalTheme", "modalAccent", "overlayBlur",
           "fontFamily", "mobileStringCount", "customCss"
    FROM "ThemeSetting"
  $q$) AS t(
    id text, "shopId" text, "buttonEnabled" boolean, "buttonLabel" text,
    "buttonBgColor" text, "buttonTextColor" text, "buttonRadius" text,
    "buttonPosition" text, "modalTheme" text, "modalAccent" text, "overlayBlur" integer,
    "fontFamily" text, "mobileStringCount" integer, "customCss" text
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO "Analytics" (
    id, "shopId", "configuratorId", "eventType", "productId", "sessionId", metadata, "createdAt"
  )
  SELECT * FROM dblink(old_conn, $q$
    SELECT id, "shopId", "configuratorId", "eventType", "productId", "sessionId", metadata, "createdAt"
    FROM "Analytics"
  $q$) AS t(
    id text, "shopId" text, "configuratorId" text, "eventType" text, "productId" text,
    "sessionId" text, metadata text, "createdAt" timestamp(3)
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO "SavedConfiguration" (
    id, "shareId", "configuratorId", "productId", selections, addons, "totalPrice",
    "createdAt", "expiresAt"
  )
  SELECT * FROM dblink(old_conn, $q$
    SELECT id, "shareId", "configuratorId", "productId", selections, addons, "totalPrice",
           "createdAt", "expiresAt"
    FROM "SavedConfiguration"
  $q$) AS t(
    id text, "shareId" text, "configuratorId" text, "productId" text, selections text,
    addons text, "totalPrice" double precision, "createdAt" timestamp(3), "expiresAt" timestamp(3)
  )
  ON CONFLICT (id) DO NOTHING;

  RAISE NOTICE 'Data copy finished. Run 3-verify-counts.sql next.';
END $$;
