import { parseJson } from "~/lib/configurator.types";
import { normalizeProductId, toProductGid } from "~/lib/product-id";
import { getProductsInCollections } from "~/lib/shopify-collections.server";

type ShopifyAdmin = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Run `fn` over `items` with at most `limit` in flight at once, preserving result order. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}

export type InventoryPolicyValue = "CONTINUE" | "DENY";

// Per-variant record of what a variant's inventoryPolicy was BEFORE this configurator first
// flipped it to CONTINUE — keyed by variant GID, carrying its product GID (so a restore can be
// grouped per product) and the original policy to put back. Persisted as JSON on the configurator.
export type InventoryPolicyBackup = Record<
  string,
  { product: string; original: InventoryPolicyValue }
>;

export type InventoryPolicyResult = {
  updated: number;
  racquets: number;
  strings: number;
  backup: InventoryPolicyBackup;
};

function normalizePolicy(value: string | undefined): InventoryPolicyValue {
  return value === "CONTINUE" ? "CONTINUE" : "DENY";
}

/**
 * Reconcile the Shopify `inventoryPolicy` of a configurator's linked products with the two
 * independent overrides (racquets, strings). For each bucket that is ON, every variant is set to
 * CONTINUE (so an out-of-stock item can be ordered — the only way /cart/add.js accepts one),
 * recording its ORIGINAL policy the first time we touch it. For each bucket that is OFF, only the
 * variants THIS configurator previously flipped (present in `backup`) are restored to their exact
 * recorded original — so a variant that was "continue selling" for other reasons is never clobbered
 * back to DENY. Variants we never touched are left completely alone.
 *
 * Racquets = explicit productIds ∪ racquet-collection products; strings = stringProductIds ∪
 * string-collection products. Best-effort — never throws, so a transient Shopify error can't fail
 * the merchant's save. Note this changes the REAL per-variant setting across every sales channel.
 *
 * @returns counts of variants changed (split racquet/string) and the updated backup map to persist.
 */
export async function applyConfiguratorInventoryPolicy(
  admin: ShopifyAdmin,
  configurator: {
    productIds: string;
    collectionIds: string;
    stringProductIds?: string;
    stringCollectionIds?: string;
  },
  opts: {
    allowRacquets: boolean;
    allowStrings: boolean;
    backup: InventoryPolicyBackup;
  },
): Promise<InventoryPolicyResult> {
  const { allowRacquets, allowStrings } = opts;
  // Work on a copy so we can return the mutated backup for persistence.
  const backup: InventoryPolicyBackup = { ...opts.backup };
  let racquets = 0;
  let strings = 0;
  const result = () => ({ updated: racquets + strings, racquets, strings, backup });
  try {
    const explicitIds = parseJson<string[]>(configurator.productIds ?? "[]", []);
    const collectionIds = parseJson<string[]>(configurator.collectionIds ?? "[]", []);
    const stringProductIds = parseJson<string[]>(configurator.stringProductIds ?? "[]", []);
    const stringCollectionIds = parseJson<string[]>(configurator.stringCollectionIds ?? "[]", []);

    // Resolve racquet-sourced and string-sourced product ids SEPARATELY (collections in parallel)
    // so each variant can be attributed to the right bucket and its own toggle.
    const [racquetCollectionProducts, stringCollectionProducts] = await Promise.all([
      collectionIds.length > 0 ? getProductsInCollections(admin, collectionIds) : Promise.resolve([]),
      stringCollectionIds.length > 0
        ? getProductsInCollections(admin, stringCollectionIds)
        : Promise.resolve([]),
    ]);
    const racquetIdSet = new Set(
      [...explicitIds, ...racquetCollectionProducts.map((p) => p.id)].map((id) =>
        normalizeProductId(String(id)),
      ),
    );
    const stringIdSet = new Set(
      [...stringProductIds, ...stringCollectionProducts.map((p) => p.id)].map((id) =>
        normalizeProductId(String(id)),
      ),
    );
    // Products to inspect: everything currently linked, PLUS any product referenced by the backup
    // (so we can still restore variants of a collection the merchant has since unlinked).
    const backupProductIds = Object.values(backup).map((b) => normalizeProductId(b.product));
    const allIds = Array.from(new Set([...racquetIdSet, ...stringIdSet, ...backupProductIds]));
    if (allIds.length === 0) return result();

    // Read each product's variants (batched, batches in parallel) with their CURRENT policy.
    const readBatches = await mapLimit(chunk(allIds, 50), 5, async (batch) => {
      const res = await admin.graphql(
        `
        #graphql
        query ProtoRacquetVariants($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on Product {
              id
              variants(first: 100) { nodes { id inventoryPolicy } }
            }
          }
        }
      `,
        { variables: { ids: batch.map((id) => toProductGid(id)) } },
      );
      const body = (await res.json()) as {
        data?: {
          nodes?: Array<
            | {
                id?: string;
                variants?: { nodes?: Array<{ id?: string; inventoryPolicy?: string }> };
              }
            | null
          >;
        };
      };
      return body.data?.nodes ?? [];
    });

    // Decide each variant's target policy, updating the backup as we go. Only variants whose
    // current policy differs from the target are collected for mutation.
    const productChanges = new Map<
      string,
      { kind: "racquet" | "string"; variants: Array<{ id: string; policy: InventoryPolicyValue }> }
    >();
    for (const nodes of readBatches) {
      for (const node of nodes) {
        if (!node?.id) continue;
        const normId = normalizeProductId(node.id);
        const isRacquet = racquetIdSet.has(normId);
        const isString = stringIdSet.has(normId);
        const kind: "racquet" | "string" = isRacquet ? "racquet" : "string";
        const allow = isRacquet ? allowRacquets : isString ? allowStrings : false;

        for (const v of node.variants?.nodes ?? []) {
          if (!v?.id) continue;
          const current = normalizePolicy(v.inventoryPolicy);
          let target: InventoryPolicyValue;
          if (allow) {
            // Turning (or keeping) the bucket ON: record the original the first time we flip it.
            if (current !== "CONTINUE" && !backup[v.id]) {
              backup[v.id] = { product: node.id, original: current };
            }
            target = "CONTINUE";
          } else {
            // Bucket OFF: only touch variants WE previously flipped; restore their exact original.
            const recorded = backup[v.id];
            if (!recorded) continue; // never touched by us → leave alone
            target = recorded.original;
            delete backup[v.id];
          }
          if (current === target) continue;
          const entry = productChanges.get(node.id) ?? { kind, variants: [] };
          entry.variants.push({ id: v.id, policy: target });
          productChanges.set(node.id, entry);
        }
      }
    }
    if (productChanges.size === 0) return result();

    // Bulk-update per product (each variant carries its own target policy), several in flight.
    const results = await mapLimit(
      Array.from(productChanges.entries()),
      8,
      async ([productGid, { kind, variants }]) => {
        const res = await admin.graphql(
          `
          #graphql
          mutation ProtoSetInventoryPolicy($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
            productVariantsBulkUpdate(productId: $productId, variants: $variants) {
              userErrors { field message }
            }
          }
        `,
          {
            variables: {
              productId: productGid,
              variants: variants.map((v) => ({ id: v.id, inventoryPolicy: v.policy })),
            },
          },
        );
        const body = (await res.json()) as {
          data?: { productVariantsBulkUpdate?: { userErrors?: Array<{ message?: string }> } };
        };
        const errors = body.data?.productVariantsBulkUpdate?.userErrors ?? [];
        if (errors.length > 0) {
          console.error("applyConfiguratorInventoryPolicy userErrors:", JSON.stringify(errors));
          return { racquet: 0, string: 0 };
        }
        return kind === "racquet"
          ? { racquet: variants.length, string: 0 }
          : { racquet: 0, string: variants.length };
      },
    );
    for (const r of results) {
      racquets += r.racquet;
      strings += r.string;
    }
  } catch (err) {
    console.error("applyConfiguratorInventoryPolicy failed:", err);
  }
  return result();
}

type ClassifiedVariant = {
  variantGid: string;
  productGid: string;
  kind: "racquet" | "string";
  current: InventoryPolicyValue;
  // Inventory facts straight from Shopify, used by the audit to prove WHY a variant is (or isn't)
  // sellable: whether Shopify itself will sell it (availableForSale — the flag the cart actually
  // checks, which respects location/sales-channel, unlike the raw admin quantity), the aggregate
  // on-hand quantity, whether inventory is tracked at all, and display names.
  availableForSale: boolean;
  quantity: number | null;
  tracked: boolean;
  productTitle: string;
  variantTitle: string;
};

/**
 * Read every variant of every product currently linked to the configurator (racquets and strings),
 * classified by bucket and carrying its current inventoryPolicy. Shared by the audit and reset
 * maintenance tools. Best-effort — returns [] on error or when nothing is linked.
 */
async function readLinkedClassifiedVariants(
  admin: ShopifyAdmin,
  configurator: {
    productIds: string;
    collectionIds: string;
    stringProductIds?: string;
    stringCollectionIds?: string;
  },
): Promise<ClassifiedVariant[]> {
  try {
    const explicitIds = parseJson<string[]>(configurator.productIds ?? "[]", []);
    const collectionIds = parseJson<string[]>(configurator.collectionIds ?? "[]", []);
    const stringProductIds = parseJson<string[]>(configurator.stringProductIds ?? "[]", []);
    const stringCollectionIds = parseJson<string[]>(configurator.stringCollectionIds ?? "[]", []);
    const [racquetCollectionProducts, stringCollectionProducts] = await Promise.all([
      collectionIds.length > 0 ? getProductsInCollections(admin, collectionIds) : Promise.resolve([]),
      stringCollectionIds.length > 0
        ? getProductsInCollections(admin, stringCollectionIds)
        : Promise.resolve([]),
    ]);
    const racquetIdSet = new Set(
      [...explicitIds, ...racquetCollectionProducts.map((p) => p.id)].map((id) =>
        normalizeProductId(String(id)),
      ),
    );
    const stringIdSet = new Set(
      [...stringProductIds, ...stringCollectionProducts.map((p) => p.id)].map((id) =>
        normalizeProductId(String(id)),
      ),
    );
    const allIds = Array.from(new Set([...racquetIdSet, ...stringIdSet]));
    if (allIds.length === 0) return [];

    const readBatches = await mapLimit(chunk(allIds, 50), 5, async (batch) => {
      const res = await admin.graphql(
        `
        #graphql
        query ProtoRacquetVariants($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on Product {
              id
              title
              variants(first: 100) {
                nodes {
                  id
                  title
                  availableForSale
                  inventoryPolicy
                  inventoryQuantity
                  inventoryItem { tracked }
                }
              }
            }
          }
        }
      `,
        { variables: { ids: batch.map((id) => toProductGid(id)) } },
      );
      const body = (await res.json()) as {
        data?: {
          nodes?: Array<
            | {
                id?: string;
                title?: string;
                variants?: {
                  nodes?: Array<{
                    id?: string;
                    title?: string;
                    availableForSale?: boolean;
                    inventoryPolicy?: string;
                    inventoryQuantity?: number | null;
                    inventoryItem?: { tracked?: boolean } | null;
                  }>;
                };
              }
            | null
          >;
        };
      };
      return body.data?.nodes ?? [];
    });

    const out: ClassifiedVariant[] = [];
    for (const nodes of readBatches) {
      for (const node of nodes) {
        if (!node?.id) continue;
        const kind: "racquet" | "string" = racquetIdSet.has(normalizeProductId(node.id))
          ? "racquet"
          : "string";
        for (const v of node.variants?.nodes ?? []) {
          if (!v?.id) continue;
          out.push({
            variantGid: v.id,
            productGid: node.id,
            kind,
            current: normalizePolicy(v.inventoryPolicy),
            availableForSale: v.availableForSale !== false,
            quantity: typeof v.inventoryQuantity === "number" ? v.inventoryQuantity : null,
            tracked: v.inventoryItem?.tracked !== false,
            productTitle: node.title ?? "Product",
            variantTitle: v.title ?? "",
          });
        }
      }
    }
    return out;
  } catch (err) {
    console.error("readLinkedClassifiedVariants failed:", err);
    return [];
  }
}

export type InventoryAuditBucket = {
  continue: number;
  deny: number;
  // Stock facts straight from Shopify's own inventory data — these decide sellability, not the
  // app: a tracked variant with quantity <= 0 and policy DENY is what /cart/add.js rejects as
  // "already sold out".
  inStock: number; // tracked, quantity > 0
  zeroStock: number; // tracked, quantity <= 0
  untracked: number; // inventory not tracked — always sellable regardless of quantity
  // Shopify's OWN sellability verdict — the flag the cart actually checks (respects location /
  // sales-channel), independent of the raw admin quantity above.
  sellable: number; // availableForSale === true
  notSellable: number; // availableForSale === false → cart rejects as "sold out"
  // The smoking gun: variants that show stock in admin (quantity > 0) yet Shopify still marks
  // NOT sellable — i.e. the stock is at a location/channel the online store can't sell from.
  phantomStock: number;
};

export type InventoryAudit = {
  racquets: InventoryAuditBucket;
  strings: InventoryAuditBucket;
  // Concrete zero-stock examples ("Product — Variant (qty N)").
  zeroStockExamples: string[];
  // Concrete phantom-stock examples: admin shows stock but Shopify won't sell it
  // ("Product — Variant (qty N, not sellable)").
  phantomStockExamples: string[];
};

/**
 * Read-only: for every linked racquet/string variant, report the inventory policy split
 * (CONTINUE vs DENY), the raw stock facts (in-stock / zero / untracked), AND Shopify's own
 * `availableForSale` verdict (sellable / not) — including "phantom stock" variants that show a
 * positive admin quantity yet Shopify still refuses to sell (stock at a location/channel the
 * online store can't reach). Proves exactly why a variant with "100 available" gets rejected.
 */
export async function auditLinkedInventoryPolicy(
  admin: ShopifyAdmin,
  configurator: {
    productIds: string;
    collectionIds: string;
    stringProductIds?: string;
    stringCollectionIds?: string;
  },
): Promise<InventoryAudit> {
  const emptyBucket = (): InventoryAuditBucket => ({
    continue: 0,
    deny: 0,
    inStock: 0,
    zeroStock: 0,
    untracked: 0,
    sellable: 0,
    notSellable: 0,
    phantomStock: 0,
  });
  const audit: InventoryAudit = {
    racquets: emptyBucket(),
    strings: emptyBucket(),
    zeroStockExamples: [],
    phantomStockExamples: [],
  };
  const variants = await readLinkedClassifiedVariants(admin, configurator);
  for (const v of variants) {
    const bucket = v.kind === "racquet" ? audit.racquets : audit.strings;
    if (v.current === "CONTINUE") bucket.continue += 1;
    else bucket.deny += 1;

    if (v.availableForSale) bucket.sellable += 1;
    else bucket.notSellable += 1;

    const qty = v.quantity ?? 0;
    const variantLabel =
      v.variantTitle && v.variantTitle !== "Default Title" ? ` — ${v.variantTitle}` : "";

    if (!v.tracked) {
      bucket.untracked += 1;
    } else if (qty > 0) {
      bucket.inStock += 1;
    } else {
      bucket.zeroStock += 1;
      if (audit.zeroStockExamples.length < 6) {
        audit.zeroStockExamples.push(`${v.productTitle}${variantLabel} (qty ${qty})`);
      }
    }

    // Admin shows stock but Shopify won't sell it — the exact "100 available yet sold out" case.
    if (qty > 0 && !v.availableForSale) {
      bucket.phantomStock += 1;
      if (audit.phantomStockExamples.length < 6) {
        audit.phantomStockExamples.push(
          `${v.productTitle}${variantLabel} (qty ${qty}, not sellable)`,
        );
      }
    }
  }
  return audit;
}

/**
 * Maintenance: force every currently-"continue selling" linked variant back to "stop selling"
 * (DENY) — Shopify's default — undoing a historical mass-flip whose per-variant originals were
 * never recorded. Only touches variants that aren't already DENY. Returns counts by bucket.
 */
export async function resetLinkedInventoryPolicyToDeny(
  admin: ShopifyAdmin,
  configurator: {
    productIds: string;
    collectionIds: string;
    stringProductIds?: string;
    stringCollectionIds?: string;
  },
): Promise<{ updated: number; racquets: number; strings: number }> {
  let racquets = 0;
  let strings = 0;
  try {
    const variants = await readLinkedClassifiedVariants(admin, configurator);
    const toChange = variants.filter((v) => v.current !== "DENY");
    if (toChange.length === 0) return { updated: 0, racquets: 0, strings: 0 };

    const byProduct = new Map<string, { kind: "racquet" | "string"; ids: string[] }>();
    for (const v of toChange) {
      const entry = byProduct.get(v.productGid) ?? { kind: v.kind, ids: [] };
      entry.ids.push(v.variantGid);
      byProduct.set(v.productGid, entry);
    }

    const results = await mapLimit(
      Array.from(byProduct.entries()),
      8,
      async ([productGid, { kind, ids }]) => {
        const res = await admin.graphql(
          `
          #graphql
          mutation ProtoResetInventoryPolicy($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
            productVariantsBulkUpdate(productId: $productId, variants: $variants) {
              userErrors { field message }
            }
          }
        `,
          {
            variables: {
              productId: productGid,
              variants: ids.map((id) => ({ id, inventoryPolicy: "DENY" })),
            },
          },
        );
        const body = (await res.json()) as {
          data?: { productVariantsBulkUpdate?: { userErrors?: Array<{ message?: string }> } };
        };
        const errors = body.data?.productVariantsBulkUpdate?.userErrors ?? [];
        if (errors.length > 0) {
          console.error("resetLinkedInventoryPolicyToDeny userErrors:", JSON.stringify(errors));
          return { racquet: 0, string: 0 };
        }
        return kind === "racquet"
          ? { racquet: ids.length, string: 0 }
          : { racquet: 0, string: ids.length };
      },
    );
    for (const r of results) {
      racquets += r.racquet;
      strings += r.string;
    }
  } catch (err) {
    console.error("resetLinkedInventoryPolicyToDeny failed:", err);
  }
  return { updated: racquets + strings, racquets, strings };
}

export type SnapshotStringInspection = {
  hasSnapshot: boolean;
  checkedLive: boolean; // false if the live comparison couldn't run (API error) — counts unverified
  stringOptions: number;
  stringVariantsInSnapshot: number;
  emptyMatrix: number; // string options with NO variant matrix (fall back to a single id)
  staleIds: number; // snapshot variant id no longer exists on the live product
  liveUnavailable: number; // snapshot id exists live but Shopify marks it unavailable
  freshAndSellable: number; // snapshot id exists live AND is sellable
  staleExamples: string[];
  emptyMatrixExamples: string[];
};

/**
 * Compare every string variant id baked into the SAVED snapshot against the live product's
 * current variants. This is the definitive test for "the storefront sends a stale/wrong variant
 * id": a snapshot id that no longer exists live is exactly what makes Shopify reject an
 * in-stock-looking variant as "sold out". Read-only.
 */
export async function inspectSnapshotStrings(
  admin: ShopifyAdmin,
  snapshotJson: string | null | undefined,
): Promise<SnapshotStringInspection> {
  const result: SnapshotStringInspection = {
    hasSnapshot: false,
    checkedLive: false,
    stringOptions: 0,
    stringVariantsInSnapshot: 0,
    emptyMatrix: 0,
    staleIds: 0,
    liveUnavailable: 0,
    freshAndSellable: 0,
    staleExamples: [],
    emptyMatrixExamples: [],
  };
  if (!snapshotJson) return result;

  let parsed: {
    configurator?: {
      steps?: Array<{
        optionGroups?: Array<{
          name?: string;
          options?: Array<{
            label?: string;
            productId?: string | null;
            metadata?: {
              variants?: Array<{
                variantId?: string;
                gauge?: string | null;
                color?: string | null;
              }>;
            };
          }>;
        }>;
      }>;
    };
  };
  try {
    parsed = JSON.parse(snapshotJson);
  } catch {
    return result;
  }
  result.hasSnapshot = true;

  type SnapOption = {
    label: string;
    productId: string | null;
    variants: Array<{ variantId: string; gauge: string | null; color: string | null }>;
  };
  const stringOptions: SnapOption[] = [];
  for (const step of parsed.configurator?.steps ?? []) {
    for (const group of step.optionGroups ?? []) {
      if (!/string/i.test(group.name ?? "")) continue;
      for (const opt of group.options ?? []) {
        stringOptions.push({
          label: opt.label ?? "String",
          productId: opt.productId ?? null,
          variants: (opt.metadata?.variants ?? [])
            .filter((v) => v?.variantId)
            .map((v) => ({
              variantId: String(v.variantId),
              gauge: v.gauge ?? null,
              color: v.color ?? null,
            })),
        });
      }
    }
  }
  result.stringOptions = stringOptions.length;
  // Count total variants + empty-matrix options up front, so these are reported even if the live
  // comparison below fails.
  for (const opt of stringOptions) {
    result.stringVariantsInSnapshot += opt.variants.length;
    if (opt.variants.length === 0) {
      result.emptyMatrix += 1;
      if (result.emptyMatrixExamples.length < 6) result.emptyMatrixExamples.push(opt.label);
    }
  }

  const productIds = Array.from(
    new Set(stringOptions.map((o) => o.productId).filter((id): id is string => Boolean(id))),
  );
  if (productIds.length === 0) {
    result.checkedLive = true;
    return result;
  }

  try {
    // Fetch live variants in BATCHES — a single nodes() call over ~200 products blows past
    // Shopify's query-cost limit (that's what crashed the page). Batch of 50 with variants(first:
    // 100), 5 batches in flight, exactly like the audit which is known to work at this scale.
    const batches = await mapLimit(chunk(productIds, 50), 5, async (batch) => {
      const res = await admin.graphql(
        `
        #graphql
        query ProtoSnapshotVariants($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on Product {
              legacyResourceId
              variants(first: 100) { nodes { legacyResourceId availableForSale } }
            }
          }
        }
      `,
        { variables: { ids: batch.map((id) => toProductGid(id)) } },
      );
      const body = (await res.json()) as {
        data?: {
          nodes?: Array<
            | {
                legacyResourceId?: string;
                variants?: {
                  nodes?: Array<{ legacyResourceId?: string; availableForSale?: boolean }>;
                };
              }
            | null
          >;
        };
      };
      return body.data?.nodes ?? [];
    });

    // productId -> (live variant id -> availableForSale)
    const liveByProduct = new Map<string, Map<string, boolean>>();
    for (const nodes of batches) {
      for (const node of nodes) {
        if (!node?.legacyResourceId) continue;
        const vmap = new Map<string, boolean>();
        for (const v of node.variants?.nodes ?? []) {
          if (v?.legacyResourceId) {
            vmap.set(String(v.legacyResourceId), v.availableForSale !== false);
          }
        }
        liveByProduct.set(normalizeProductId(node.legacyResourceId), vmap);
      }
    }

    for (const opt of stringOptions) {
      if (opt.variants.length === 0) continue;
      const liveVars = opt.productId
        ? liveByProduct.get(normalizeProductId(opt.productId))
        : undefined;
      for (const v of opt.variants) {
        if (!liveVars || !liveVars.has(v.variantId)) {
          result.staleIds += 1;
          if (result.staleExamples.length < 8) {
            const label = [v.color, v.gauge].filter(Boolean).join(" / ");
            result.staleExamples.push(
              `${opt.label}${label ? ` — ${label}` : ""} → snapshot id ${v.variantId} (no longer exists live)`,
            );
          }
        } else if (liveVars.get(v.variantId) === false) {
          result.liveUnavailable += 1;
        } else {
          result.freshAndSellable += 1;
        }
      }
    }
    result.checkedLive = true;
  } catch (err) {
    console.error("inspectSnapshotStrings live check failed:", err);
    result.checkedLive = false;
  }
  return result;
}

// Must match the "no real curation signal" threshold in storefront/lib/string-catalog.ts
// (RECOMMENDED_MAX_COVERAGE) — kept as a separate constant here since this file has no import
// relationship with the storefront bundle, but the two MUST stay numerically in sync.
const RECOMMENDED_MAX_COVERAGE = 0.8;

export type RecommendedStringsAudit = {
  hasSnapshot: boolean;
  totalStringCatalog: number;
  racquets: Array<{
    racquetProductId: string;
    standardCount: number;
    standardCoveragePct: number;
    standardWouldShow: boolean;
    hybridCount: number;
    hybridCoveragePct: number;
    hybridWouldShow: boolean;
  }>;
};

/**
 * Read-only: for every racquet that has a recommended-strings entry in the saved snapshot, report
 * how many strings are in its recommended set vs. the TOTAL string catalog size, and whether the
 * storefront's 80%-coverage safeguard (storefront/lib/string-catalog.ts) would currently suppress
 * the "Recommended" badge/tab for it. Answers "is the 80% threshold actually what's hiding this?"
 * with real numbers from the live saved snapshot, instead of guessing.
 */
export function auditRecommendedStringsCoverage(
  snapshotJson: string | null | undefined,
): RecommendedStringsAudit {
  const result: RecommendedStringsAudit = {
    hasSnapshot: false,
    totalStringCatalog: 0,
    racquets: [],
  };
  if (!snapshotJson) return result;

  let parsed: {
    configurator?: {
      steps?: Array<{
        optionGroups?: Array<{
          name?: string;
          options?: Array<{ id?: string; productId?: string | null }>;
        }>;
      }>;
    };
    recommendedStringsByRacquet?: Record<string, string[]>;
    recommendedHybridStringsByRacquet?: Record<string, string[]>;
  };
  try {
    parsed = JSON.parse(snapshotJson);
  } catch {
    return result;
  }
  result.hasSnapshot = true;

  // Mirror storefront/lib/string-catalog.ts#resolveStringCatalog's exact catalog dedup: every
  // option group whose name matches "string", options deduped by productId ?? id.
  const seen = new Set<string>();
  let totalCatalog = 0;
  for (const step of parsed.configurator?.steps ?? []) {
    for (const group of step.optionGroups ?? []) {
      if (!/string/i.test(group.name ?? "")) continue;
      for (const opt of group.options ?? []) {
        const key = opt.productId ?? opt.id ?? "";
        if (!key || seen.has(key)) continue;
        seen.add(key);
        totalCatalog += 1;
      }
    }
  }
  result.totalStringCatalog = totalCatalog;

  const standardMap = parsed.recommendedStringsByRacquet ?? {};
  const hybridMap = parsed.recommendedHybridStringsByRacquet ?? {};
  const racquetIds = Array.from(new Set([...Object.keys(standardMap), ...Object.keys(hybridMap)]));

  const pct = (n: number) => (totalCatalog > 0 ? Math.round((n / totalCatalog) * 100) : 0);
  const wouldShow = (n: number) =>
    n > 0 && totalCatalog > 0 && n < totalCatalog * RECOMMENDED_MAX_COVERAGE;

  for (const racquetProductId of racquetIds) {
    const standardCount = standardMap[racquetProductId]?.length ?? 0;
    const hybridCount = hybridMap[racquetProductId]?.length ?? 0;
    result.racquets.push({
      racquetProductId,
      standardCount,
      standardCoveragePct: pct(standardCount),
      standardWouldShow: wouldShow(standardCount),
      hybridCount,
      hybridCoveragePct: pct(hybridCount),
      hybridWouldShow: wouldShow(hybridCount),
    });
  }

  return result;
}
