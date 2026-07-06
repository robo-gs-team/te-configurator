import type { StorefrontConfigurator, TensionRange } from "~/lib/configurator.types";
import { DEFAULT_TENSION_RANGE } from "~/lib/configurator.types";

export type { TensionRange };
export { DEFAULT_TENSION_RANGE };

export type StringProduct = {
  id: string;
  name: string;
  type: string;
  price: number;
  gauges: string[];
  colors: string[];
  recommended?: boolean;
  recommendedHybrid?: boolean;
  imageUrl?: string | null;
  variantId?: string | null;
  productId?: string | null;
};

export type BedSelection = {
  stringId: string;
  gauge: string;
  color: string;
  tension: number;
};

export const SWATCH_COLORS: Record<string, string> = {
  Black: "#1a1a1a",
  White: "#f0f0f0",
  Yellow: "#f5c518",
  Blue: "#2563eb",
  Pink: "#ec4899",
  Gold: "#d4af37",
  Natural: "#e8dcc8",
  Silver: "#b0b0b0",
  Green: "#22c55e",
};

// Crosses default to 5% above mains, per spec §3 ("in line with standard stringing
// practice"), clamped to the racquet's own tension range.
export function crossesFromMains(mainsTension: number, range: TensionRange): number {
  const raw = Math.round(mainsTension * 1.05);
  return Math.min(range.max, Math.max(range.min, raw));
}

export function formatStringPrice(price: number): string {
  return price === 0 ? "Free" : `+$${price}`;
}

export function getStringById(
  catalog: StringProduct[],
  id: string,
): StringProduct | undefined {
  return catalog.find((s) => s.id === id);
}

export function defaultBed(
  catalog: StringProduct[],
  tensionRange: TensionRange = DEFAULT_TENSION_RANGE,
  preferredId?: string,
): BedSelection {
  const product =
    catalog.find((s) => s.id === preferredId) ??
    catalog.find((s) => s.recommended) ??
    catalog[0];
  if (!product) {
    return { stringId: "", gauge: "16", color: "Natural", tension: tensionRange.recommended };
  }
  return {
    stringId: product.id,
    gauge: product.gauges[0],
    color: product.colors[0],
    tension: tensionRange.recommended,
  };
}

export function defaultHybridBeds(
  catalog: StringProduct[],
  tensionRange: TensionRange = DEFAULT_TENSION_RANGE,
) {
  // Prefer the racquet's hybrid recommendation (then standard, then first) for the mains bed.
  const mainsPick =
    catalog.find((s) => s.recommendedHybrid) ??
    catalog.find((s) => s.recommended) ??
    catalog[0];
  const mainsTension = tensionRange.recommended;
  return {
    mains: {
      stringId: mainsPick?.id ?? "",
      gauge: "16",
      color: "Black",
      tension: mainsTension,
    },
    crosses: {
      // A different hybrid-recommended string if there is one, else any other string.
      stringId:
        catalog.find((s) => s.recommendedHybrid && s.id !== mainsPick?.id)?.id ??
        catalog.find((s) => s.id !== mainsPick?.id)?.id ??
        mainsPick?.id ??
        "",
      gauge: "16",
      color: "Natural",
      tension: crossesFromMains(mainsTension, tensionRange),
    },
  };
}

// Resolving the catalog re-flattens every step's option groups and rebuilds the price/gauge/
// color arrays — cheap once, but this is read from a Zustand selector (getStringingTotal) that
// re-runs on every store update, including every tick of the tension slider. The configurator
// object reference is stable for the life of a modal session (only replaced by store.open()),
// so a WeakMap keyed on it turns repeat calls into a cache hit instead of a full recompute.
const catalogCache = new WeakMap<StorefrontConfigurator, StringProduct[]>();

export function resolveStringCatalog(
  configurator: StorefrontConfigurator | null,
): StringProduct[] {
  if (!configurator) return [];

  const cached = catalogCache.get(configurator);
  if (cached) return cached;

  // Strings this specific racquet recommends (from its strings_collection / hybrid_strings_collection
  // metafields), resolved per-racquet by the proxy. Used to badge them "Recommended" and drive the
  // default filter — the standard set in standard mode, the hybrid set in hybrid mode.
  const recommendedSet = new Set(configurator.recommendedStringProductIds ?? []);
  const recommendedHybridSet = new Set(configurator.recommendedHybridStringProductIds ?? []);

  // Merge every group whose name matches "string" (not just the first) — a merchant may
  // split string sources across multiple groups (e.g. one per collection), and each one
  // represents real configuration effort that must reach the shopper.
  const stringGroups = configurator.steps
    .flatMap((s) => s.optionGroups)
    .filter((g) => /string/i.test(g.name));

  // Dedup by productId (falling back to option id for manually-entered options with no
  // linked product) — a merchant could add the same string product to more than one group.
  const seen = new Set<string>();
  const allOptions = stringGroups
    .flatMap((g) => g.options)
    .filter((o) => {
      const key = o.productId ?? o.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  if (allOptions.length === 0) {
    return [];
  }

  // A "recommended" set that covers the entire catalog carries no signal for the shopper (it's
  // most likely a racquet's recommended-strings metafield pointing at the same collection as the
  // full string list) — treat it as unset rather than badge every single string "Recommended".
  const effectiveRecommendedSet =
    recommendedSet.size > 0 && recommendedSet.size < allOptions.length
      ? recommendedSet
      : new Set<string>();
  const effectiveRecommendedHybridSet =
    recommendedHybridSet.size > 0 && recommendedHybridSet.size < allOptions.length
      ? recommendedHybridSet
      : new Set<string>();

  const colorGroup = configurator.steps
    .flatMap((s) => s.optionGroups)
    .find((g) => /color/i.test(g.name));

  const colors =
    colorGroup?.options.map((o) => o.label) ??
    ["Black", "White", "Natural"];

  const result = allOptions.map((option) => {
    const meta = option.metadata as {
      type?: string;
      gauges?: string[];
      colors?: string[];
      recommended?: boolean;
    };
    return {
      id: option.id,
      name: option.label,
      type: meta.type ?? "String",
      price: option.priceAdjust,
      gauges: meta.gauges?.length ? meta.gauges : ["16", "17"],
      colors: meta.colors?.length ? meta.colors : colors,
      // "Recommended" = this racquet's own recommended-strings collection (per-racquet metafield),
      // or an explicit metafield flag. NOT just first-in-list (which previously mislabeled
      // whatever led the catalog, e.g. a stringing machine). `recommendedHybrid` is the same for
      // the racquet's hybrid recommendation, used by the mains/crosses columns.
      recommended:
        (option.productId ? effectiveRecommendedSet.has(option.productId) : false) ||
        Boolean(meta.recommended),
      recommendedHybrid: option.productId
        ? effectiveRecommendedHybridSet.has(option.productId)
        : false,
      imageUrl: option.imageUrl ?? option.previewLayer ?? null,
      variantId: option.variantId,
      productId: option.productId,
    };
  });

  catalogCache.set(configurator, result);
  return result;
}

export function usesStringingUi(configurator: StorefrontConfigurator | null): boolean {
  if (!configurator) return false;
  return Boolean(configurator.laborVariantId);
}

export function bedSummary(
  catalog: StringProduct[],
  bed: BedSelection,
): string {
  const product = getStringById(catalog, bed.stringId);
  if (!product) return "";
  return `${product.name} · ${bed.gauge}g · ${bed.color} · ${bed.tension} lbs`;
}
