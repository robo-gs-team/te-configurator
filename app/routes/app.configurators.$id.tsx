import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Checkbox,
  FormLayout,
  InlineStack,
  Layout,
  Page,
  Spinner,
  Text,
  TextField,
} from "@shopify/polaris";
import { useEffect, useRef, useState } from "react";
import { AddonAddForm } from "~/components/AddonAddForm";
import { CollectionPicker } from "~/components/CollectionPicker";
import { LaborProductPicker, type LaborProductSelection } from "~/components/LaborProductPicker";
import { OptionAddForm } from "~/components/OptionAddForm";
import { OptionGroupSourcePicker } from "~/components/OptionGroupSourcePicker";
import { ProductPicker } from "~/components/ProductPicker";
import { RemoveItemButton } from "~/components/RemoveItemButton";
import { StepAddForm } from "~/components/StepAddForm";
import prisma from "~/db.server";
import {
  ensureShop,
  getConfiguratorById,
} from "~/lib/configurator.server";
import { refreshConfiguratorSnapshot } from "~/lib/snapshot.server";
import { runAfterResponse } from "~/lib/after-response.server";
import {
  detectConfiguratorOverlap,
  type ConfiguratorOverlap,
} from "~/lib/configurator-overlap.server";
import {
  applyConfiguratorInventoryPolicy,
  auditLinkedInventoryPolicy,
  auditRecommendedStringsCoverage,
  resetLinkedInventoryPolicyToDeny,
  type InventoryAudit,
  type InventoryPolicyBackup,
  type InventoryPolicyResult,
  type RecommendedStringsAudit,
} from "~/lib/inventory.server";
import { ensureTensionMetafieldDefinitions } from "~/lib/product-metafields.server";
import { parseJson } from "~/lib/configurator.types";
import { parseCollectionIdsField } from "~/lib/collection-id";
import { parseProductIdsField } from "~/lib/product-id";
import { getCollectionsByIds } from "~/lib/shopify-collections.server";
import { getProductsByIds } from "~/lib/shopify-products.server";
import { authenticate } from "~/shopify.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const configurator = await getConfiguratorById(params.id!);

  if (!configurator || configurator.shopId !== shop.id) {
    throw new Response("Not found", { status: 404 });
  }

  const collectionIds = parseJson<string[]>(configurator.collectionIds, []);
  const stringCollectionIds = parseJson<string[]>(
    (configurator as typeof configurator & { stringCollectionIds?: string }).stringCollectionIds ?? "[]",
    [],
  );
  const stringProductIds = parseJson<string[]>(
    (configurator as typeof configurator & { stringProductIds?: string }).stringProductIds ?? "[]",
    [],
  );
  const excludedProductIds = parseJson<string[]>(
    (configurator as typeof configurator & { excludedProductIds?: string }).excludedProductIds ?? "[]",
    [],
  );
  // Collect every option group's collection/product IDs up front so we can fetch them in
  // TWO batched Shopify calls total (getCollectionsByIds / getProductsByIds both accept
  // arbitrarily many IDs via nodes(ids:)), instead of 2 serial calls PER group.
  const groupCollectionIds: Record<string, string[]> = {};
  const groupProductIds: Record<string, string[]> = {};
  const allGroupCollectionIds = new Set<string>();
  const allGroupProductIds = new Set<string>();
  for (const step of configurator.steps) {
    for (const group of step.optionGroups) {
      const cids = parseJson<string[]>(group.collectionIds ?? "[]", []);
      const pids = parseJson<string[]>(group.productIds ?? "[]", []);
      groupCollectionIds[group.id] = cids;
      groupProductIds[group.id] = pids;
      cids.forEach((id) => allGroupCollectionIds.add(id));
      pids.forEach((id) => allGroupProductIds.add(id));
    }
  }

  const [
    collections,
    stringCollections,
    products,
    stringProducts,
    excludedProducts,
    ,
    allGroupCollections,
    allGroupProducts,
  ] = await Promise.all([
    getCollectionsByIds(admin, collectionIds),
    getCollectionsByIds(admin, stringCollectionIds),
    getProductsByIds(admin, parseJson<string[]>(configurator.productIds, [])),
    getProductsByIds(admin, stringProductIds),
    getProductsByIds(admin, excludedProductIds),
    // Idempotent — checks existence first (cached per shop after the first call), only creates
    // on first-ever call. Registers the per-racquet tension metafield definitions so they show
    // up in Shopify's native "Metafields" section on every product page.
    ensureTensionMetafieldDefinitions(admin, session.shop),
    allGroupCollectionIds.size > 0
      ? getCollectionsByIds(admin, [...allGroupCollectionIds])
      : Promise.resolve([]),
    allGroupProductIds.size > 0
      ? getProductsByIds(admin, [...allGroupProductIds])
      : Promise.resolve([]),
  ]);

  // Partition the batched results back to each group in memory.
  const collectionById = new Map(allGroupCollections.map((c) => [c.id, c]));
  const productById = new Map(allGroupProducts.map((p) => [p.id, p]));
  const groupCollections: Record<string, Awaited<ReturnType<typeof getCollectionsByIds>>> = {};
  const groupProducts: Record<string, Awaited<ReturnType<typeof getProductsByIds>>> = {};
  for (const step of configurator.steps) {
    for (const group of step.optionGroups) {
      groupCollections[group.id] = groupCollectionIds[group.id]
        .map((id) => collectionById.get(id))
        .filter((c): c is NonNullable<typeof c> => Boolean(c));
      groupProducts[group.id] = groupProductIds[group.id]
        .map((id) => productById.get(id))
        .filter((p): p is NonNullable<typeof p> => Boolean(p));
    }
  }

  const labor: LaborProductSelection | null = configurator.laborVariantId
    ? {
        variantId: configurator.laborVariantId,
        title: "Stringing labor",
        price: configurator.laborPrice,
      }
    : null;

  // Strip the two big server-only blobs before sending to the browser: the enriched storefront
  // snapshot (the full variant matrix for every string — hundreds of KB on a large catalog) and
  // the per-variant inventory-policy backup. Neither is rendered by this page; they're read only
  // server-side by the action's diagnostic/maintenance intents (which re-fetch the configurator).
  const {
    enrichedSnapshot: _enrichedSnapshot,
    inventoryPolicyBackup: _inventoryPolicyBackup,
    ...configuratorForClient
  } = configurator as typeof configurator & {
    enrichedSnapshot?: string | null;
    inventoryPolicyBackup?: string | null;
  };
  void _enrichedSnapshot;
  void _inventoryPolicyBackup;

  return json({
    configurator: configuratorForClient,
    collections,
    stringCollections,
    products,
    stringProducts,
    excludedProducts,
    groupCollections,
    groupProducts,
    labor,
  });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const form = await request.formData();
  const intent = String(form.get("intent"));

  const existing = await getConfiguratorById(params.id!);
  if (!existing || existing.shopId !== shop.id) {
    throw new Response("Not found", { status: 404 });
  }

  if (intent === "update") {
    const name = String(form.get("name") || "").trim();
    const description = String(form.get("description") || "").trim();
    const collectionIds = parseCollectionIdsField(String(form.get("collectionIds") || ""));
    const stringCollectionIds = parseCollectionIdsField(String(form.get("stringCollectionIds") || ""));
    const productIds = parseProductIdsField(String(form.get("productIds") || ""));
    const stringProductIds = parseProductIdsField(String(form.get("stringProductIds") || ""));
    const excludedProductIds = parseProductIdsField(String(form.get("excludedProductIds") || ""));
    const laborVariantId = String(form.get("laborVariantId") || "").trim() || null;
    const laborPrice = parseFloat(String(form.get("laborPrice") || "0")) || 0;
    const basePrice = parseFloat(String(form.get("basePrice") || "0")) || 0;
    const isActive = form.get("isActive") === "on";
    const allowOutOfStockRacquets = form.get("allowOutOfStockRacquets") === "on";
    const allowOutOfStockStrings = form.get("allowOutOfStockStrings") === "on";
    const hideOutOfStockStrings = form.get("hideOutOfStockStrings") === "on";
    const existingBackup = parseJson<InventoryPolicyBackup>(
      (existing as { inventoryPolicyBackup?: string }).inventoryPolicyBackup ?? "{}",
      {},
    );
    const wasRacquets = Boolean(
      (existing as { allowOutOfStockRacquets?: boolean }).allowOutOfStockRacquets,
    );
    const wasStrings = Boolean(
      (existing as { allowOutOfStockStrings?: boolean }).allowOutOfStockStrings,
    );

    await prisma.configurator.update({
      where: { id: params.id },
      data: {
        name,
        description: description || null,
        productIds: JSON.stringify(productIds),
        collectionIds: JSON.stringify(collectionIds),
        stringCollectionIds: JSON.stringify(stringCollectionIds),
        stringProductIds: JSON.stringify(stringProductIds),
        excludedProductIds: JSON.stringify(excludedProductIds),
        allowOutOfStockRacquets,
        allowOutOfStockStrings,
        hideOutOfStockStrings,
        laborVariantId,
        laborPrice,
        basePrice,
        isActive,
      } as Parameters<typeof prisma.configurator.update>[0]["data"],
    });

    // Reconcile the Shopify inventory policy for both buckets. When a bucket is ON we re-apply
    // CONTINUE on every save (idempotent + self-heals a prior silent failure); when OFF we restore
    // exactly the variants THIS configurator flipped, back to their recorded originals. We only run
    // it when there's real work to do: a bucket is ON, or there's a backup to reconcile/restore.
    const linkedIds = {
      productIds: JSON.stringify(productIds),
      collectionIds: JSON.stringify(collectionIds),
      stringProductIds: JSON.stringify(stringProductIds),
      stringCollectionIds: JSON.stringify(stringCollectionIds),
    };
    const needsInventoryRun =
      allowOutOfStockRacquets ||
      allowOutOfStockStrings ||
      wasRacquets ||
      wasStrings ||
      Object.keys(existingBackup).length > 0;

    // The inventory-policy call (Shopify) and the per-group source updates (DB) are independent,
    // so run them concurrently. One save covers everything on the page: general settings above,
    // plus every option group's product sources below (submitted as groupCollections_<id> /
    // groupProducts_<id> hidden fields — see OptionGroupSourcePicker).
    const allGroups = existing.steps.flatMap((step) => step.optionGroups);
    const [inventoryResult] = await Promise.all([
      needsInventoryRun
        ? applyConfiguratorInventoryPolicy(admin, linkedIds, {
            allowRacquets: allowOutOfStockRacquets,
            allowStrings: allowOutOfStockStrings,
            backup: existingBackup,
          })
        : Promise.resolve<InventoryPolicyResult | null>(null),
      Promise.all(
        allGroups.map((group) => {
          const groupCollectionIds = form.get(`groupCollections_${group.id}`);
          const groupProductIds = form.get(`groupProducts_${group.id}`);
          if (groupCollectionIds === null && groupProductIds === null) return null;
          return prisma.optionGroup.update({
            where: { id: group.id },
            data: {
              collectionIds: JSON.stringify(
                parseCollectionIdsField(String(groupCollectionIds ?? "[]")),
              ),
              productIds: JSON.stringify(
                parseProductIdsField(String(groupProductIds ?? "[]")),
              ),
            },
          });
        }),
      ),
    ]);

    // Persist the updated per-variant backup so a later revert can restore exact originals.
    if (inventoryResult) {
      await prisma.configurator.update({
        where: { id: params.id },
        data: {
          inventoryPolicyBackup: JSON.stringify(inventoryResult.backup),
        } as Parameters<typeof prisma.configurator.update>[0]["data"],
      });
    }

    // B1: rebuild the enriched snapshot (best-effort) + bust the cache so shoppers see the change.
    // Deferred to AFTER the response so the merchant's Save returns immediately instead of blocking
    // on a full catalog re-enrichment (the biggest source of perceived Save slowness). The DB write
    // + inventory policy above already ran synchronously, so the admin UI is correct on reload; the
    // snapshot (shopper-facing only) finishes rebuilding a few seconds later in the background.
    runAfterResponse(() => refreshConfiguratorSnapshot(admin, params.id!, shop.id, session.shop));
    return json({
      success: true,
      inventory: inventoryResult
        ? {
            updated: inventoryResult.updated,
            racquets: inventoryResult.racquets,
            strings: inventoryResult.strings,
          }
        : null,
    });
  }

  // Read-only, on-demand maintenance: does this configurator's racquet assignment overlap with
  // another configurator's? Moved off the regular Save path (where it briefly lived) — resolving
  // collection membership for every configurator in the shop is real synchronous Shopify API work,
  // and Save must never be blocked by that (this app's Save-speed work earlier deliberately kept
  // Shopify calls off this exact path). Triggered explicitly via its own button instead.
  if (intent === "check_overlap") {
    const productIds = parseProductIdsField((existing as { productIds?: string }).productIds ?? "[]");
    const collectionIds = parseCollectionIdsField(
      (existing as { collectionIds?: string }).collectionIds ?? "[]",
    );
    const excludedProductIds = parseProductIdsField(
      (existing as { excludedProductIds?: string }).excludedProductIds ?? "[]",
    );
    const overlapWarnings = await detectConfiguratorOverlap(admin, shop.id, params.id!, {
      productIds,
      collectionIds,
      excludedProductIds,
    });
    return json({ overlapWarnings: overlapWarnings.length > 0 ? overlapWarnings : null });
  }

  // Read-only maintenance: report how many linked variants are currently "continue" vs "deny".
  if (intent === "audit_inventory") {
    const linkedIds = {
      productIds: (existing as { productIds?: string }).productIds ?? "[]",
      collectionIds: (existing as { collectionIds?: string }).collectionIds ?? "[]",
      stringProductIds: (existing as { stringProductIds?: string }).stringProductIds ?? "[]",
      stringCollectionIds: (existing as { stringCollectionIds?: string }).stringCollectionIds ?? "[]",
    };
    const audit = await auditLinkedInventoryPolicy(admin, linkedIds);
    return json({ audit });
  }

  // Read-only diagnostic: for each racquet, how many strings are in its recommended set vs. the
  // total catalog, and whether the storefront's 80%-coverage safeguard would suppress the
  // "Recommended" badge/tab for it. Proves (or disproves) that safeguard with real numbers.
  if (intent === "audit_recommended") {
    const recommendedAudit = auditRecommendedStringsCoverage(
      (existing as { enrichedSnapshot?: string | null }).enrichedSnapshot,
    );
    return json({ recommendedAudit });
  }

  // Rebuild the enriched snapshot from live Shopify data NOW (fresh variant ids/prices/availability
  // for every string), so the merchant can force-refresh what shoppers see without a full Save.
  if (intent === "rebuild_snapshot") {
    await refreshConfiguratorSnapshot(admin, params.id!, shop.id, session.shop);
    return json({ rebuilt: true });
  }

  // Maintenance: force every currently-"continue" linked variant back to "deny" (Shopify's
  // default), clearing the backup and turning both overrides off. Used to undo a historical
  // mass-flip whose per-variant originals were never recorded.
  if (intent === "reset_inventory") {
    const linkedIds = {
      productIds: (existing as { productIds?: string }).productIds ?? "[]",
      collectionIds: (existing as { collectionIds?: string }).collectionIds ?? "[]",
      stringProductIds: (existing as { stringProductIds?: string }).stringProductIds ?? "[]",
      stringCollectionIds: (existing as { stringCollectionIds?: string }).stringCollectionIds ?? "[]",
    };
    const reset = await resetLinkedInventoryPolicyToDeny(admin, linkedIds);
    await prisma.configurator.update({
      where: { id: params.id },
      data: {
        allowOutOfStockRacquets: false,
        allowOutOfStockStrings: false,
        inventoryPolicyBackup: "{}",
      } as Parameters<typeof prisma.configurator.update>[0]["data"],
    });
    await refreshConfiguratorSnapshot(admin, params.id!, shop.id, session.shop);
    return json({ reset });
  }

  if (intent === "add_step") {
    const stepTitle = String(form.get("stepTitle") || "").trim();
    if (!stepTitle) {
      return json({ error: "Step title is required", intent }, { status: 400 });
    }

    const stepCount = await prisma.configuratorStep.count({
      where: { configuratorId: params.id },
    });

    await prisma.configuratorStep.create({
      data: {
        configuratorId: params.id!,
        title: stepTitle,
        stepType: "variant",
        sortOrder: stepCount,
      },
    });

    runAfterResponse(() => refreshConfiguratorSnapshot(admin, params.id!, shop.id, session.shop));
    return json({ success: true, intent });
  }

  if (intent === "add_addon") {
    const addonSource = String(form.get("addonSource") || "product");
    const addonName = String(form.get("addonName") || "").trim();
    const productIds = parseProductIdsField(String(form.get("productIds") || ""));
    const collectionIds = parseCollectionIdsField(String(form.get("collectionIds") || ""));

    if (addonSource === "product" && productIds.length === 0) {
      return json({ error: "Select at least one product", intent }, { status: 400 });
    }
    if (addonSource === "collection" && collectionIds.length === 0) {
      return json({ error: "Select at least one collection", intent }, { status: 400 });
    }

    await prisma.addon.create({
      data: {
        configuratorId: params.id!,
        name: addonName || "Add-on",
        price: parseFloat(String(form.get("addonPrice") || "0")) || 0,
        description: String(form.get("addonDescription") || "").trim() || null,
        productIds: JSON.stringify(addonSource === "product" ? productIds : []),
        collectionIds: JSON.stringify(addonSource === "collection" ? collectionIds : []),
        sortOrder: existing.addons.length,
      },
    });

    runAfterResponse(() => refreshConfiguratorSnapshot(admin, params.id!, shop.id, session.shop));
    return json({ success: true, intent });
  }

  if (intent === "add_option") {
    const stepId = String(form.get("stepId") || "").trim();
    const groupName = String(form.get("groupName") || "Options").trim();
    const optionLabel = String(form.get("optionLabel") || "").trim();
    const optionValue =
      String(form.get("optionValue") || "").trim() ||
      optionLabel.toLowerCase().replace(/\s+/g, "_");
    const colorHex = String(form.get("colorHex") || "").trim() || null;
    const productId = String(form.get("productId") || "").trim() || null;
    const priceAdjust = parseFloat(String(form.get("priceAdjust") || "0")) || 0;

    if (!stepId) {
      return json({ error: "Step is required", intent }, { status: 400 });
    }
    if (!optionLabel && !productId) {
      return json({ error: "Option label or product is required", intent }, { status: 400 });
    }

    const step = await prisma.configuratorStep.findFirst({
      where: { id: stepId, configuratorId: params.id },
    });
    if (!step) {
      return json({ error: "Step not found", intent }, { status: 404 });
    }
    if (step.stepType !== "variant" && step.stepType !== "options") {
      return json(
        {
          error: `Cannot add options to a "${step.stepType}" step. Add a variant step instead.`,
          intent,
        },
        { status: 400 },
      );
    }

    let group = await prisma.optionGroup.findFirst({
      where: { stepId, name: groupName },
    });

    if (!group) {
      const groupCount = await prisma.optionGroup.count({ where: { stepId } });
      group = await prisma.optionGroup.create({
        data: {
          stepId,
          name: groupName,
          displayType: "swatch",
          sortOrder: groupCount,
        },
      });
    }

    const optionCount = await prisma.option.count({
      where: { optionGroupId: group.id },
    });

    await prisma.option.create({
      data: {
        optionGroupId: group.id,
        label: optionLabel || "Option",
        value: optionValue,
        priceAdjust,
        colorHex,
        imageUrl: null,
        previewLayer: null,
        variantId: null,
        productId,
        sortOrder: optionCount,
        isDefault: optionCount === 0,
      },
    });

    runAfterResponse(() => refreshConfiguratorSnapshot(admin, params.id!, shop.id, session.shop));
    return json({ success: true, intent });
  }

  if (intent === "delete_step") {
    const stepId = String(form.get("stepId") || "").trim();
    const step = await prisma.configuratorStep.findFirst({
      where: { id: stepId, configuratorId: params.id },
    });
    if (!step) {
      return json({ error: "Step not found", intent }, { status: 404 });
    }
    await prisma.configuratorStep.delete({ where: { id: stepId } });
    runAfterResponse(() => refreshConfiguratorSnapshot(admin, params.id!, shop.id, session.shop));
    return json({ success: true, intent });
  }

  return json({ ok: true });
};

/** "1 racquet variant" / "816 string variants" — singular/plural, for the OOS-apply banner. */
function formatVariantCount(count: number, noun: "racquet" | "string"): string {
  return `${count} ${noun} variant${count === 1 ? "" : "s"}`;
}

function SummaryRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "critical";
}) {
  return (
    <InlineStack gap="200" align="space-between" blockAlign="start" wrap={false}>
      <Text as="span" variant="bodySm" tone="subdued">
        {label}
      </Text>
      <Box maxWidth="70%">
        <Text as="span" variant="bodySm" alignment="end" tone={tone}>
          {value}
        </Text>
      </Box>
    </InlineStack>
  );
}

// A field label carrying a badge that tells the merchant whether shoppers see this field.
// "shopper" = the value (or the products it selects) is visible in the storefront modal/cart;
// "setup" = it only controls behaviour (e.g. where the button appears) and is never shown.
function FieldLabel({
  children,
  facing,
}: {
  children: string;
  facing: "shopper" | "setup";
}) {
  return (
    <InlineStack gap="200" blockAlign="center">
      <Text as="span" variant="bodyMd" fontWeight="semibold">
        {children}
      </Text>
      <Badge tone={facing === "shopper" ? "info" : undefined}>
        {facing === "shopper" ? "Shown to shoppers" : "Setup only"}
      </Badge>
    </InlineStack>
  );
}

export default function EditConfigurator() {
  const {
    configurator,
    collections,
    stringCollections,
    products,
    stringProducts,
    excludedProducts,
    groupCollections,
    groupProducts,
    labor,
  } = useLoaderData<typeof loader>();
  const navigation = useNavigation();

  const [name, setName] = useState(configurator.name);
  const [description, setDescription] = useState(configurator.description ?? "");
  const [selectedCollections, setSelectedCollections] = useState(collections);
  const [selectedStringCollections, setSelectedStringCollections] = useState(stringCollections);
  const [selectedProducts, setSelectedProducts] = useState(products);
  const [selectedStringProducts, setSelectedStringProducts] = useState(stringProducts);
  const [excludedProductsSel, setExcludedProductsSel] = useState(excludedProducts);
  const [laborProduct, setLaborProduct] = useState<LaborProductSelection | null>(labor);
  // Kept only as a hidden fallback value; the racquet price is now read live from the page.
  const [basePrice] = useState(String(configurator.basePrice));
  const [isActive, setIsActive] = useState(configurator.isActive);
  const [allowOutOfStockRacquets, setAllowOutOfStockRacquets] = useState(
    Boolean((configurator as { allowOutOfStockRacquets?: boolean }).allowOutOfStockRacquets),
  );
  const [allowOutOfStockStrings, setAllowOutOfStockStrings] = useState(
    Boolean((configurator as { allowOutOfStockStrings?: boolean }).allowOutOfStockStrings),
  );
  const [hideOutOfStockStrings, setHideOutOfStockStrings] = useState(
    Boolean((configurator as { hideOutOfStockStrings?: boolean }).hideOutOfStockStrings),
  );

  const formRef = useRef<HTMLFormElement>(null);

  // Snapshot of the values as of the last successful save, used only to detect unsaved edits —
  // a plain JSON comparison against current state is far simpler than tracking dirtiness field
  // by field, and cheap given how small these values are.
  const buildSnapshot = () => ({
    name,
    description,
    basePrice,
    isActive,
    selectedCollections,
    selectedStringCollections,
    selectedProducts,
    selectedStringProducts,
    excludedProductsSel,
    allowOutOfStockRacquets,
    allowOutOfStockStrings,
    hideOutOfStockStrings,
    laborProduct,
  });
  const [savedSnapshot, setSavedSnapshot] = useState(buildSnapshot);
  const latestSnapshotRef = useRef(buildSnapshot());
  latestSnapshotRef.current = buildSnapshot();
  const isDirty = JSON.stringify(latestSnapshotRef.current) !== JSON.stringify(savedSnapshot);

  // After a save, surface how many racquet vs string variants the out-of-stock toggle updated,
  // plus results of the read-only audit and the reset-to-Deny maintenance tools.
  const actionData = useActionData<{
    inventory?: { updated: number; racquets: number; strings: number } | null;
    audit?: InventoryAudit;
    reset?: { updated: number; racquets: number; strings: number };
    rebuilt?: boolean;
    recommendedAudit?: RecommendedStringsAudit;
    overlapWarnings?: ConfiguratorOverlap[] | null;
  }>();
  const inventoryResult =
    navigation.state === "idle" ? actionData?.inventory ?? null : null;
  const auditResult = navigation.state === "idle" ? actionData?.audit ?? null : null;
  const resetResult = navigation.state === "idle" ? actionData?.reset ?? null : null;
  const snapshotRebuilt = navigation.state === "idle" ? actionData?.rebuilt ?? false : false;
  const recommendedAudit =
    navigation.state === "idle" ? actionData?.recommendedAudit ?? null : null;
  const overlapWarnings =
    navigation.state === "idle" ? actionData?.overlapWarnings ?? null : null;
  const [confirmingReset, setConfirmingReset] = useState(false);
  // Which maintenance action (if any) is currently running — drives the "Working…" indicator so
  // the merchant knows to wait (these hit Shopify across the whole catalog and can take a minute).
  const runningIntent =
    navigation.state !== "idle" ? String(navigation.formData?.get("intent") ?? "") : "";
  const maintenanceRunning = [
    "audit_inventory",
    "rebuild_snapshot",
    "reset_inventory",
    "audit_recommended",
    "check_overlap",
  ].includes(runningIntent);
  const maintenanceLabel: Record<string, string> = {
    audit_inventory: "Checking current policy",
    rebuild_snapshot: "Rebuilding snapshot from live Shopify",
    reset_inventory: "Resetting inventory policy",
    audit_recommended: "Checking recommended-strings coverage",
    check_overlap: "Checking for racquet overlaps with other configurators",
  };

  // Once this form's own submission completes, treat the just-submitted values as the new
  // clean baseline so the "Unsaved changes" indicator clears.
  const wasSubmittingThisForm = useRef(false);
  useEffect(() => {
    const isSubmittingThisForm =
      navigation.state !== "idle" && navigation.formData?.get("intent") === "update";
    if (wasSubmittingThisForm.current && !isSubmittingThisForm) {
      setSavedSnapshot(latestSnapshotRef.current);
    }
    wasSubmittingThisForm.current = isSubmittingThisForm;
  }, [navigation.state, navigation.formData]);

  return (
    <Page
      title={configurator.name}
      backAction={{ content: "Configurators", url: "/app/configurators" }}
      titleMetadata={
        <InlineStack gap="200" blockAlign="center">
          <Badge tone={configurator.isActive ? "success" : undefined}>
            {configurator.isActive ? "Active" : "Inactive"}
          </Badge>
          {isDirty && <Badge tone="attention">Unsaved changes</Badge>}
        </InlineStack>
      }
      primaryAction={
        <Button
          variant="primary"
          loading={navigation.state !== "idle"}
          onClick={() => formRef.current?.requestSubmit()}
        >
          Save changes
        </Button>
      }
    >
      <Layout>
        {!configurator.isActive && (
          <Layout.Section>
            <Banner tone="warning" title="Configurator is inactive">
              <p>
                The storefront will not load this configurator until <strong>Active</strong> is
                enabled and you click <strong>Save changes</strong> below.
              </p>
            </Banner>
          </Layout.Section>
        )}
        {inventoryResult && (
          <Layout.Section>
            <Banner tone={inventoryResult.updated > 0 ? "success" : "warning"}>
              <p>
                {inventoryResult.updated > 0
                  ? `Out-of-stock setting applied in Shopify: ${formatVariantCount(inventoryResult.racquets, "racquet")} and ${formatVariantCount(inventoryResult.strings, "string")} updated. String variants cover every product in the linked string collection(s), so that count is usually the large one.`
                  : "No variants were updated — everything linked was already at the target setting, or no racquet/string collections/products are linked above."}
              </p>
            </Banner>
          </Layout.Section>
        )}
        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  Summary
                </Text>
                <Badge tone={isActive ? "success" : undefined}>
                  {isActive ? "Active" : "Inactive"}
                </Badge>
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                Unsaved edits below are reflected here live. Click Save changes to apply them.
              </Text>
              <Box paddingBlockStart="100">
                <BlockStack gap="150">
                  <SummaryRow
                    label="Racquet collections"
                    value={
                      selectedCollections.length > 0
                        ? selectedCollections.map((c) => c.title).join(", ")
                        : "None"
                    }
                  />
                  <SummaryRow
                    label="Individual racquets"
                    value={
                      selectedProducts.length > 0
                        ? selectedProducts.map((p) => p.title).join(", ")
                        : "None"
                    }
                  />
                  <SummaryRow
                    label="String collections"
                    value={
                      selectedStringCollections.length > 0
                        ? selectedStringCollections.map((c) => c.title).join(", ")
                        : "None"
                    }
                  />
                  <SummaryRow
                    label="Individual strings"
                    value={
                      selectedStringProducts.length > 0
                        ? selectedStringProducts.map((p) => p.title).join(", ")
                        : "None"
                    }
                  />
                  <SummaryRow
                    label="Labor product"
                    value={
                      laborProduct
                        ? `${laborProduct.title} ($${laborProduct.price.toFixed(2)})`
                        : "Not set"
                    }
                    tone={laborProduct ? undefined : "critical"}
                  />
                  <SummaryRow label="Racquet price" value="Pulled live from the product page" />
                  <SummaryRow
                    label="Add-ons"
                    value={
                      configurator.addons.length > 0
                        ? `${configurator.addons.length} configured`
                        : "None"
                    }
                  />
                </BlockStack>
              </Box>
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section>
          <Form method="post" ref={formRef}>
            <input type="hidden" name="intent" value="update" />
            <BlockStack gap="400">
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  General settings
                </Text>
                <Banner tone="info">
                  <p>
                    <Badge tone="info">Shown to shoppers</Badge> fields appear in the storefront
                    modal or cart exactly as entered. <Badge>Setup only</Badge> fields never show
                    to shoppers — they just control how the configurator behaves.
                  </p>
                </Banner>
                <FormLayout>
                  <TextField
                    label={<FieldLabel facing="shopper">Name</FieldLabel>}
                    name="name"
                    value={name}
                    onChange={setName}
                    helpText="Appears as the title at the top of the configurator modal."
                    autoComplete="off"
                  />
                  <TextField
                    label={<FieldLabel facing="shopper">Description</FieldLabel>}
                    name="description"
                    value={description}
                    onChange={setDescription}
                    helpText="Appears as the subtitle under the name in the modal."
                    multiline={2}
                    autoComplete="off"
                  />
                  <CollectionPicker
                    label={<FieldLabel facing="setup">Racquet collections</FieldLabel>}
                    helpText="Products in these collections will show the Configure button."
                    selected={selectedCollections}
                    onChange={setSelectedCollections}
                  />
                  <ProductPicker
                    label={<FieldLabel facing="setup">Individual racquet products</FieldLabel>}
                    helpText="These specific products will also show the Configure button."
                    selected={selectedProducts}
                    onChange={setSelectedProducts}
                  />
                  <Banner tone="info" title="Set stringing tension per racquet">
                    <BlockStack gap="150">
                      <p>
                        Each racquet has its own recommended tension. Open any racquet product in
                        Shopify admin → <strong>Metafields</strong>, and fill in the three
                        &quot;Stringing tension&quot; fields (Min / Max / Recommended, lbs).
                        Racquets left blank use a default range of 46–55 lbs.
                      </p>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Technical field names, if you need to match them exactly:{" "}
                        <code>te_stringing.tension_min</code>,{" "}
                        <code>te_stringing.tension_max</code>,{" "}
                        <code>te_stringing.tension_recommended</code>.
                      </Text>
                    </BlockStack>
                  </Banner>
                  <CollectionPicker
                    label={<FieldLabel facing="shopper">String collections</FieldLabel>}
                    helpText="Products in these collections appear as string options shoppers can pick in the configurator."
                    name="stringCollectionIds"
                    selected={selectedStringCollections}
                    onChange={setSelectedStringCollections}
                  />
                  <ProductPicker
                    label={<FieldLabel facing="shopper">Individual string products</FieldLabel>}
                    helpText="These specific products also appear as string options, in addition to any string collections above."
                    name="stringProductIds"
                    selected={selectedStringProducts}
                    onChange={setSelectedStringProducts}
                  />
                  <ProductPicker
                    label={<FieldLabel facing="setup">Excluded products</FieldLabel>}
                    helpText="Products to hide from the configurator — removed from the string list (e.g. a stringing machine) and never shown the Configure button, even if a collection above would otherwise include them."
                    name="excludedProductIds"
                    selected={excludedProductsSel}
                    onChange={setExcludedProductsSel}
                  />
                  <LaborProductPicker selected={laborProduct} onChange={setLaborProduct} />
                  {/* The racquet price is pulled live from the product page at open time — no
                      manual base price needed. `basePrice` stays in the DB as a fallback only. */}
                  <input type="hidden" name="basePrice" value={basePrice} />
                  <Checkbox
                    label={<FieldLabel facing="setup">Active</FieldLabel>}
                    checked={isActive}
                    onChange={setIsActive}
                  />
                  {isActive ? (
                    <input type="hidden" name="isActive" value="on" />
                  ) : null}
                  <Checkbox
                    label={<FieldLabel facing="setup">Allow ordering out-of-stock racquets</FieldLabel>}
                    checked={allowOutOfStockRacquets}
                    onChange={setAllowOutOfStockRacquets}
                    helpText="Lets shoppers configure and buy even when the racquet is out of stock. On save this sets the Shopify inventory policy to “Continue selling when out of stock” on every variant of every linked racquet — a real Shopify setting that applies to ALL sales channels. Turning it off restores each of THOSE variants to exactly the setting it had before this app changed it (it won't clobber SKUs that were already “continue selling” for other reasons)."
                  />
                  {allowOutOfStockRacquets ? (
                    <input type="hidden" name="allowOutOfStockRacquets" value="on" />
                  ) : null}
                  <Checkbox
                    label={<FieldLabel facing="setup">Allow ordering out-of-stock strings</FieldLabel>}
                    checked={allowOutOfStockStrings}
                    onChange={setAllowOutOfStockStrings}
                    helpText="Same as above, but for strings (the shop provides them). This covers EVERY variant of every product in the linked string collection(s) — so it can be hundreds of variants across all sales channels. Turning it off restores each variant this app changed back to its exact prior setting."
                  />
                  {allowOutOfStockStrings ? (
                    <input type="hidden" name="allowOutOfStockStrings" value="on" />
                  ) : null}
                  <Checkbox
                    label={<FieldLabel facing="setup">Hide out-of-stock strings from the picker</FieldLabel>}
                    checked={hideOutOfStockStrings}
                    onChange={setHideOutOfStockStrings}
                    helpText="Independent of the setting above — removes strings Shopify reports as out of stock from the list entirely, so a shopper can never select one. Useful if you'd rather hide them than rely on the override to make them sellable."
                  />
                  {hideOutOfStockStrings ? (
                    <input type="hidden" name="hideOutOfStockStrings" value="on" />
                  ) : null}
                </FormLayout>
                <Button submit variant="primary" loading={navigation.state !== "idle"}>
                  Save changes
                </Button>
              </BlockStack>
            </Card>

            {/* Steps & options is the legacy generic-configurator editor. Stringing configurators
                (which have a labor product) source everything from the fields above, so it's just
                clutter there — hide it. Any leftover manual step data is ignored by enrichment. */}
            {!laborProduct && (
            <Card>
              <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Steps & options
              </Text>
              <Banner tone="info">
                <p>
                  Most stringing configurators don't need this section — racquets and strings
                  are already fully configured above. Only add a step here if you need string
                  options beyond the collections/products above; other step or option types
                  won't appear to shoppers, since stringing configurators use a dedicated
                  interface.
                </p>
              </Banner>
              {configurator.steps.length === 0 ? (
                <Text as="p" tone="subdued">
                  No steps yet. Add a step below, then add options to it.
                </Text>
              ) : (
                configurator.steps.map((step) => (
                  <Box
                    key={step.id}
                    padding="400"
                    background="bg-surface-secondary"
                    borderRadius="200"
                  >
                    <BlockStack gap="300">
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="h3" variant="headingSm">
                          {step.title}{" "}
                          <Badge>{step.stepType}</Badge>
                        </Text>
                        <RemoveItemButton
                          intent="delete_step"
                          id={step.id}
                          idField="stepId"
                          label="Remove step"
                        />
                      </InlineStack>
                      {step.optionGroups.length === 0 ? (
                        <Text as="p" variant="bodySm" tone="subdued">
                          No option groups yet.
                        </Text>
                      ) : (
                        step.optionGroups.map((group) => (
                          <BlockStack key={group.id} gap="200">
                            <Text as="p" variant="bodySm" fontWeight="semibold">
                              {group.name} ({group.displayType})
                            </Text>
                            <InlineStack gap="200" wrap>
                              {group.options.map((opt) => (
                                <Badge key={opt.id}>
                                  {opt.label}
                                  {opt.priceAdjust ? ` (+$${opt.priceAdjust})` : ""}
                                </Badge>
                              ))}
                            </InlineStack>
                            {(step.stepType === "variant" || step.stepType === "options") ? (
                              <OptionGroupSourcePicker
                                groupId={group.id}
                                groupName={group.name}
                                initialCollections={groupCollections[group.id] ?? []}
                                initialProducts={groupProducts[group.id] ?? []}
                              />
                            ) : null}
                          </BlockStack>
                        ))
                      )}
                      {step.stepType === "variant" || step.stepType === "options" ? (
                        <OptionAddForm stepId={step.id} />
                      ) : (
                        <Text as="p" variant="bodySm" tone="subdued">
                          Options can only be added to variant or options steps (not{" "}
                          {step.stepType}).
                        </Text>
                      )}
                    </BlockStack>
                  </Box>
                ))
              )}
              <Box paddingBlockStart="200">
                <Text as="h3" variant="headingSm">
                  Add step
                </Text>
                <Box paddingBlockStart="200">
                  <StepAddForm />
                </Box>
              </Box>
              <Button submit variant="primary" loading={navigation.state !== "idle"}>
                Save changes
              </Button>
              </BlockStack>
            </Card>
            )}
            </BlockStack>
          </Form>
        </Layout.Section>

        <Layout.Section variant="oneHalf">
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Add-ons
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Optional extras the shopper can add alongside their racquet + stringing —
                e.g. extra grip tape, a vibration dampener, or a racquet bag. Link a Shopify
                product or collection and the image, price, and variant are pulled in
                automatically (or set a manual price). Shown as cards in the configurator popup,
                right before Add to Cart; shoppers can bump the quantity up if you allow more
                than one.
              </Text>
              <Box
                padding="300"
                background="bg-surface-secondary"
                borderRadius="200"
                borderStyle="dashed"
                borderWidth="025"
              >
                <BlockStack gap="150">
                  <Text as="p" variant="bodySm" tone="subdued" fontWeight="medium">
                    Preview — what shoppers see
                  </Text>
                  <InlineStack gap="300" blockAlign="center">
                    <Box
                      background="bg-surface-tertiary"
                      borderRadius="200"
                      minWidth="48px"
                      minHeight="48px"
                    />
                    <BlockStack gap="050">
                      <Text as="span" variant="bodySm" fontWeight="semibold">
                        Vibration Dampener
                      </Text>
                      <Text as="span" variant="bodySm" tone="subdued">
                        +$4.99
                      </Text>
                    </BlockStack>
                    <Box paddingInlineStart="400">
                      <InlineStack gap="150" blockAlign="center">
                        <Badge>−</Badge>
                        <Text as="span" variant="bodySm">1</Text>
                        <Badge>+</Badge>
                      </InlineStack>
                    </Box>
                  </InlineStack>
                </BlockStack>
              </Box>
              {configurator.addons.length === 0 ? (
                <Text as="p" variant="bodySm" tone="subdued">
                  No add-ons yet. Skip this section if you only need string/options.
                </Text>
              ) : (
                configurator.addons.map((addon) => {
                  const pids = parseJson<string[]>(addon.productIds ?? "[]", []);
                  const cids = parseJson<string[]>(addon.collectionIds ?? "[]", []);
                  const source =
                    pids.length > 0
                      ? `${pids.length} product(s)`
                      : cids.length > 0
                        ? `${cids.length} collection(s)`
                        : addon.variantId
                          ? "manual variant"
                          : "unlinked";
                  return (
                    <InlineStack key={addon.id} align="space-between">
                      <Text as="span">
                        {addon.name}{" "}
                        <Text as="span" tone="subdued">
                          ({source})
                        </Text>
                      </Text>
                      <Text as="span" tone="subdued">
                        {addon.price > 0 ? `+$${addon.price.toFixed(2)}` : "Shopify price"}
                      </Text>
                    </InlineStack>
                  );
                })
              )}
              <AddonAddForm />
            </BlockStack>
          </Card>
        </Layout.Section>

        {configurator.rules.length > 0 && (
          <Layout.Section variant="oneHalf">
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Conditional rules
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Advanced logic configured on this configurator. New rules can no longer be
                  added here — most stringing setups don't need them, and this simple list view
                  is read-only.
                </Text>
                {configurator.rules.map((rule) => (
                  <Text as="p" key={rule.id} variant="bodySm">
                    IF {rule.conditionField} {rule.conditionOp} &quot;{rule.conditionValue}
                    &quot; THEN {rule.actionType}
                    {rule.actionTarget ? ` → ${rule.actionTarget}` : ""}
                  </Text>
                ))}
              </BlockStack>
            </Card>
          </Layout.Section>
        )}
        {auditResult && (
          <Layout.Section>
            <Banner tone="info" title="Shopify inventory audit for linked products">
              <BlockStack gap="150">
                <Text as="p" variant="bodySm">
                  <strong>Policy</strong> — Racquets: {auditResult.racquets.continue} “continue
                  selling”, {auditResult.racquets.deny} “stop selling”. Strings:{" "}
                  {auditResult.strings.continue} “continue selling”,{" "}
                  {auditResult.strings.deny} “stop selling”.
                </Text>
                <Text as="p" variant="bodySm">
                  <strong>Stock (admin quantity)</strong> — Racquet variants:{" "}
                  {auditResult.racquets.inStock} in stock, {auditResult.racquets.zeroStock} at
                  zero, {auditResult.racquets.untracked} untracked. String variants:{" "}
                  {auditResult.strings.inStock} in stock, {auditResult.strings.zeroStock} at zero,{" "}
                  {auditResult.strings.untracked} untracked.
                </Text>
                <Text as="p" variant="bodySm">
                  <strong>Sellable per Shopify (availableForSale — what the cart checks)</strong> —
                  Racquets: {auditResult.racquets.sellable} sellable,{" "}
                  {auditResult.racquets.notSellable} not. Strings:{" "}
                  {auditResult.strings.sellable} sellable, {auditResult.strings.notSellable} not.
                  Of those, <strong>{auditResult.strings.phantomStock} string</strong> and{" "}
                  {auditResult.racquets.phantomStock} racquet variants show stock in admin yet
                  Shopify still won't sell them (stock sits at a location/channel the online store
                  can't reach) — that's the “100 available but sold out” case.
                </Text>
                {auditResult.phantomStockExamples.length > 0 && (
                  <Text as="p" variant="bodySm">
                    <strong>Phantom-stock examples:</strong>{" "}
                    {auditResult.phantomStockExamples.join(" · ")}
                  </Text>
                )}
                {auditResult.zeroStockExamples.length > 0 && (
                  <Text as="p" variant="bodySm">
                    <strong>Zero-stock examples:</strong>{" "}
                    {auditResult.zeroStockExamples.join(" · ")}
                  </Text>
                )}
              </BlockStack>
            </Banner>
          </Layout.Section>
        )}
        {resetResult && (
          <Layout.Section>
            <Banner tone="success" title="Inventory policy reset">
              <p>
                Set back to “stop selling when out of stock”:{" "}
                {formatVariantCount(resetResult.racquets, "racquet")} and{" "}
                {formatVariantCount(resetResult.strings, "string")}. Both out-of-stock overrides
                are now off.
              </p>
            </Banner>
          </Layout.Section>
        )}
        {overlapWarnings && overlapWarnings.length > 0 && (
          <Layout.Section>
            <Banner tone="warning" title="Racquet(s) also assigned to another configurator">
              <BlockStack gap="200">
                <Text as="p">
                  The Configure button on the racquet(s) below may not show reliably, since
                  more than one configurator now claims them and only one can win. Use each
                  configurator's "Excluded products" field to remove the overlap, or adjust
                  the collections/products assigned above.
                </Text>
                {overlapWarnings.map((overlap) => (
                  <Text as="p" key={overlap.configuratorId}>
                    Shared with <strong>{overlap.configuratorName}</strong>:{" "}
                    {overlap.products.map((p) => p.title).join(", ")}
                  </Text>
                ))}
              </BlockStack>
            </Banner>
          </Layout.Section>
        )}
        {snapshotRebuilt && (
          <Layout.Section>
            <Banner tone="success" title="Snapshot rebuilt">
              <p>
                Rebuilt the storefront snapshot from live Shopify data — shoppers now see current
                strings, prices, and availability for every racquet.
              </p>
            </Banner>
          </Layout.Section>
        )}
        {recommendedAudit && (
          <Layout.Section>
            <Banner
              tone={recommendedAudit.hasSnapshot ? "info" : "warning"}
              title="Recommended-strings coverage (why the tab shows or hides)"
            >
              <BlockStack gap="150">
                {!recommendedAudit.hasSnapshot ? (
                  <Text as="p" variant="bodySm">
                    No saved snapshot yet — click "Rebuild snapshot now" above first, then check
                    again.
                  </Text>
                ) : recommendedAudit.racquets.length === 0 ? (
                  <Text as="p" variant="bodySm">
                    No racquet has a recommended-strings collection set on its
                    "configurator.strings_collection" / "configurator.hybrid_strings_collection"
                    metafield — so there's nothing to badge as Recommended for any linked racquet.
                  </Text>
                ) : (
                  <>
                    <Text as="p" variant="bodySm">
                      Total string catalog: {recommendedAudit.totalStringCatalog} strings. The
                      "Recommended" tab/badge only shows when a racquet's recommended set covers
                      LESS than 80% of that total — otherwise it's treated as "no real curation"
                      and suppressed.
                    </Text>
                    {recommendedAudit.racquets.map((r) => (
                      <Text as="p" variant="bodySm" key={r.racquetProductId}>
                        <strong>Racquet {r.racquetProductId}:</strong> standard recommended{" "}
                        {r.standardCount}/{recommendedAudit.totalStringCatalog} (
                        {r.standardCoveragePct}% —{" "}
                        {r.standardWouldShow ? "would show" : "suppressed"}); hybrid recommended{" "}
                        {r.hybridCount}/{recommendedAudit.totalStringCatalog} ({r.hybridCoveragePct}
                        % — {r.hybridWouldShow ? "would show" : "suppressed"}).
                      </Text>
                    ))}
                  </>
                )}
              </BlockStack>
            </Banner>
          </Layout.Section>
        )}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Inventory policy maintenance (testing only)
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Testing/diagnostic tools — not part of everyday setup. They act on the Shopify
                “continue selling when out of stock” policy for this configurator's linked racquets
                and strings. <strong>Check current policy</strong> is read-only.
                <strong> Reset to Deny</strong> sets every currently-“continue selling” linked
                variant back to “stop selling” (Shopify's default) across all sales channels, and
                turns both overrides off — use it to undo an earlier bulk change.
              </Text>
              <InlineStack gap="300">
                <Form method="post">
                  <input type="hidden" name="intent" value="audit_inventory" />
                  <Button
                    submit
                    loading={
                      navigation.state !== "idle" &&
                      navigation.formData?.get("intent") === "audit_inventory"
                    }
                  >
                    Check current policy
                  </Button>
                </Form>
                <Form method="post">
                  <input type="hidden" name="intent" value="rebuild_snapshot" />
                  <Button
                    submit
                    variant="primary"
                    loading={
                      navigation.state !== "idle" &&
                      navigation.formData?.get("intent") === "rebuild_snapshot"
                    }
                  >
                    Rebuild snapshot now
                  </Button>
                </Form>
                <Form method="post">
                  <input type="hidden" name="intent" value="audit_recommended" />
                  <Button
                    submit
                    loading={
                      navigation.state !== "idle" &&
                      navigation.formData?.get("intent") === "audit_recommended"
                    }
                  >
                    Check recommended-strings coverage
                  </Button>
                </Form>
                <Form method="post">
                  <input type="hidden" name="intent" value="check_overlap" />
                  <Button
                    submit
                    loading={
                      navigation.state !== "idle" &&
                      navigation.formData?.get("intent") === "check_overlap"
                    }
                  >
                    Check for racquet overlaps with other configurators
                  </Button>
                </Form>
                {confirmingReset ? (
                  <Form method="post" onSubmit={() => setConfirmingReset(false)}>
                    <input type="hidden" name="intent" value="reset_inventory" />
                    <InlineStack gap="200">
                      <Button
                        submit
                        variant="primary"
                        tone="critical"
                        loading={
                          navigation.state !== "idle" &&
                          navigation.formData?.get("intent") === "reset_inventory"
                        }
                      >
                        Yes, reset all to Deny
                      </Button>
                      <Button onClick={() => setConfirmingReset(false)}>Cancel</Button>
                    </InlineStack>
                  </Form>
                ) : (
                  <Button tone="critical" onClick={() => setConfirmingReset(true)}>
                    Reset to Deny…
                  </Button>
                )}
              </InlineStack>
              {maintenanceRunning && (
                <InlineStack gap="200" blockAlign="center">
                  <Spinner accessibilityLabel="Working" size="small" />
                  <Text as="span" variant="bodySm" tone="subdued">
                    {maintenanceLabel[runningIntent] ?? "Working"} — please wait. This scans your
                    whole catalog and can take up to a minute; don't close the page.
                  </Text>
                </InlineStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}