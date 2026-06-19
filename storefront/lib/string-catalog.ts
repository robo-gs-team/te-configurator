import type { StorefrontConfigurator } from "~/lib/configurator.types";

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

export const TENSION_MIN = 46;
export const TENSION_MAX = 55;
export const TENSION_REC_STANDARD = 51;
export const TENSION_REC_MAINS = 51;
export const TENSION_REC_CROSSES = 53;

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

export function defaultBed(catalog: StringProduct[], preferredId?: string): BedSelection {
  const product =
    catalog.find((s) => s.id === preferredId) ??
    catalog.find((s) => s.recommended) ??
    catalog[0];
  return {
    stringId: product.id,
    gauge: product.gauges[0],
    color: product.colors[0],
    tension: TENSION_REC_STANDARD,
  };
}

export function defaultHybridBeds(catalog: StringProduct[]) {
  return {
    mains: {
      stringId: catalog.find((s) => s.name === "Babolat RPM Blast")?.id ?? catalog[1]?.id ?? catalog[0].id,
      gauge: "16",
      color: "Black",
      tension: TENSION_REC_MAINS,
    },
    crosses: {
      stringId: catalog.find((s) => s.name === "Wilson NXT 16")?.id ?? catalog[4]?.id ?? catalog[0].id,
      gauge: "16",
      color: "Natural",
      tension: TENSION_REC_CROSSES,
    },
  };
}

export function resolveStringCatalog(
  configurator: StorefrontConfigurator | null,
): StringProduct[] {
  if (!configurator) return DEFAULT_STRING_CATALOG;

  const stringGroup = configurator.steps
    .flatMap((s) => s.optionGroups)
    .find((g) => /string/i.test(g.name));

  if (!stringGroup || stringGroup.options.length === 0) {
    return DEFAULT_STRING_CATALOG;
  }

  const colorGroup = configurator.steps
    .flatMap((s) => s.optionGroups)
    .find((g) => /color/i.test(g.name));

  const colors =
    colorGroup?.options.map((o) => o.label) ??
    DEFAULT_STRING_CATALOG[0].colors;

  return stringGroup.options.map((option) => {
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
      imageUrl: option.imageUrl,
      variantId: option.variantId,
      productId: option.productId,
    };
  });
}

export function usesStringingUi(configurator: StorefrontConfigurator | null): boolean {
  if (!configurator) return false;
  return configurator.steps.some((step) =>
    step.optionGroups.some((g) => /string|gauge|tension/i.test(g.name)),
  );
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
