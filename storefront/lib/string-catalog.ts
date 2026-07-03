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

export const DEFAULT_STRING_CATALOG: StringProduct[] = [
  {
    id: "te-synthetic-gut",
    name: "TE Synthetic Gut",
    type: "Synthetic gut",
    price: 0,
    gauges: ["16", "17"],
    colors: ["Black", "White", "Yellow", "Blue", "Pink", "Gold"],
    recommended: true,
  },
  {
    id: "babolat-rpm-blast",
    name: "Babolat RPM Blast",
    type: "Polyester",
    price: 14,
    gauges: ["15L", "16", "17"],
    colors: ["Black"],
  },
  {
    id: "luxilon-alu-power",
    name: "Luxilon ALU Power",
    type: "Co-polyester",
    price: 16,
    gauges: ["16L", "16"],
    colors: ["Silver"],
  },
  {
    id: "solinco-hyper-g",
    name: "Solinco Hyper-G",
    type: "Polyester",
    price: 20,
    gauges: ["16", "17", "18"],
    colors: ["Green"],
  },
  {
    id: "wilson-nxt-16",
    name: "Wilson NXT 16",
    type: "Multifilament",
    price: 18,
    gauges: ["16", "17"],
    colors: ["Natural", "Black"],
  },
  {
    id: "babolat-vs-touch",
    name: "Babolat VS Touch",
    type: "Natural gut",
    price: 42,
    gauges: ["15L", "16"],
    colors: ["Natural"],
  },
];

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
  const first = catalog[0];
  const mainsTension = tensionRange.recommended;
  return {
    mains: {
      stringId: catalog.find((s) => s.recommended)?.id ?? catalog[0]?.id ?? "",
      gauge: "16",
      color: "Black",
      tension: mainsTension,
    },
    crosses: {
      stringId: catalog.find((s) => s.id !== first?.id)?.id ?? first?.id ?? "",
      gauge: "16",
      color: "Natural",
      tension: crossesFromMains(mainsTension, tensionRange),
    },
  };
}

export function resolveStringCatalog(
  configurator: StorefrontConfigurator | null,
): StringProduct[] {
  if (!configurator) return [];

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

  const colorGroup = configurator.steps
    .flatMap((s) => s.optionGroups)
    .find((g) => /color/i.test(g.name));

  const colors =
    colorGroup?.options.map((o) => o.label) ??
    ["Black", "White", "Natural"];

  return allOptions.map((option) => {
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
      recommended: option.isDefault || meta.recommended,
      imageUrl: option.imageUrl ?? option.previewLayer ?? null,
      variantId: option.variantId,
      productId: option.productId,
    };
  });
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

export function bedShortSummary(
  catalog: StringProduct[],
  bed: BedSelection,
): string {
  const product = getStringById(catalog, bed.stringId);
  if (!product) return "";
  const shortName = product.name.split(" ").slice(-2).join(" ");
  return `${shortName} · ${bed.gauge}g · ${bed.tension} lbs`;
}
