import type {
  Addon,
  ConditionalRule,
  Configurator,
  ConfiguratorStep,
  Option,
  OptionGroup,
  ThemeSetting,
} from "@prisma/client";

// Re-exported so other modules can import the Prisma Addon type from here alongside the
// configurator types, rather than reaching into @prisma/client directly.
export type { Addon };

export type ConfiguratorWithRelations = Configurator & {
  steps: (ConfiguratorStep & {
    optionGroups: (OptionGroup & { options: Option[] })[];
  })[];
  addons: Addon[];
  rules: ConditionalRule[];
};

// Per-racquet stringing tension (spec §3: "sourced from per-SKU Shopify metafields").
// Resolved server-side for the specific racquet product being viewed; falls back to
// DEFAULT_TENSION_RANGE (storefront/lib/string-catalog.ts) when a racquet has none set.
export type TensionRange = { min: number; max: number; recommended: number };

export type StorefrontConfigurator = {
  id: string;
  name: string;
  description: string | null;
  basePrice: number;
  currency: string;
  laborVariantId: string | null;
  laborPrice: number;
  steps: StorefrontStep[];
  addons: StorefrontAddon[];
  rules: StorefrontRule[];
  theme: StorefrontTheme;
  tensionRange: TensionRange;
  // Product ids of strings recommended for the specific racquet being viewed (from that
  // racquet's strings_collection / hybrid_strings_collection metafields). Drive the default
  // "Recommended" filter — the standard set in standard mode, the hybrid set in the mains/crosses
  // columns. Empty when the racquet has none configured. Set per-request by the proxy.
  recommendedStringProductIds: string[];
  recommendedHybridStringProductIds: string[];
};

export type StorefrontStep = {
  id: string;
  title: string;
  description: string | null;
  stepType: string;
  sortOrder: number;
  isRequired: boolean;
  optionGroups: StorefrontOptionGroup[];
};

export type StorefrontOptionGroup = {
  id: string;
  name: string;
  displayType: string;
  sortOrder: number;
  isRequired: boolean;
  options: StorefrontOption[];
};

export type StorefrontOption = {
  id: string;
  label: string;
  value: string;
  imageUrl: string | null;
  previewLayer: string | null;
  priceAdjust: number;
  variantId: string | null;
  productId: string | null;
  colorHex: string | null;
  sortOrder: number;
  isDefault: boolean;
  metadata: Record<string, unknown>;
};

export type StorefrontAddon = {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  price: number;
  variantId: string | null;
  maxQuantity: number;
  sortOrder: number;
  metadata: Record<string, unknown>;
};

export type StorefrontRule = {
  id: string;
  conditionField: string;
  conditionOp: string;
  conditionValue: string;
  actionType: string;
  actionTarget: string | null;
  actionValue: Record<string, unknown>;
};

export type StorefrontTheme = {
  buttonEnabled: boolean;
  buttonLabel: string;
  buttonBgColor: string;
  buttonTextColor: string;
  buttonRadius: string;
  buttonPosition: string;
  modalTheme: string;
  modalAccent: string;
  overlayBlur: number;
  fontFamily: string;
};

export type SelectionState = Record<string, string>;

// Fallback tension range used when a racquet has no tension metafields set yet.
export const DEFAULT_TENSION_RANGE: TensionRange = { min: 46, max: 55, recommended: 51 };

export function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function serializeConfiguratorPayload(
  configurator: ConfiguratorWithRelations,
  theme: ThemeSetting | null,
  tensionRange: TensionRange = DEFAULT_TENSION_RANGE,
  recommendedStringProductIds: string[] = [],
  recommendedHybridStringProductIds: string[] = [],
): StorefrontConfigurator {
  const defaultTheme: StorefrontTheme = {
    buttonEnabled: true,
    buttonLabel: "Customize Product",
    buttonBgColor: "#111827",
    buttonTextColor: "#ffffff",
    buttonRadius: "12px",
    buttonPosition: "after_add_to_cart",
    modalTheme: "dark",
    modalAccent: "#6366f1",
    overlayBlur: 12,
    fontFamily: "system-ui",
  };

  return {
    id: configurator.id,
    name: configurator.name,
    description: configurator.description,
    basePrice: configurator.basePrice,
    currency: configurator.currency,
    laborVariantId: configurator.laborVariantId ?? null,
    laborPrice: configurator.laborPrice ?? 0,
    steps: configurator.steps
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((step) => ({
        id: step.id,
        title: step.title,
        description: step.description,
        stepType: step.stepType,
        sortOrder: step.sortOrder,
        isRequired: step.isRequired,
        optionGroups: step.optionGroups
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((group) => ({
            id: group.id,
            name: group.name,
            displayType: group.displayType,
            sortOrder: group.sortOrder,
            isRequired: group.isRequired,
            options: group.options
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((option) => ({
                id: option.id,
                label: option.label,
                value: option.value,
                imageUrl: option.imageUrl,
                previewLayer: option.previewLayer,
                priceAdjust: option.priceAdjust,
                variantId: option.variantId,
                productId: option.productId ?? null,
                colorHex: option.colorHex,
                sortOrder: option.sortOrder,
                isDefault: option.isDefault,
                metadata: parseJson(option.metadata, {}),
              })),
          })),
      })),
    addons: configurator.addons
      .filter((a) => a.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((addon) => ({
        id: addon.id,
        name: addon.name,
        description: addon.description,
        imageUrl: addon.imageUrl,
        price: addon.price,
        variantId: addon.variantId,
        maxQuantity: addon.maxQuantity,
        sortOrder: addon.sortOrder,
        metadata: parseJson(addon.metadata, {}),
      })),
    rules: configurator.rules
      .filter((r) => r.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((rule) => ({
        id: rule.id,
        conditionField: rule.conditionField,
        conditionOp: rule.conditionOp,
        conditionValue: rule.conditionValue,
        actionType: rule.actionType,
        actionTarget: rule.actionTarget,
        actionValue: parseJson(rule.actionValue, {}),
      })),
    theme: theme
      ? {
          buttonEnabled: theme.buttonEnabled,
          buttonLabel: theme.buttonLabel,
          buttonBgColor: theme.buttonBgColor,
          buttonTextColor: theme.buttonTextColor,
          buttonRadius: theme.buttonRadius,
          buttonPosition: theme.buttonPosition,
          modalTheme: theme.modalTheme,
          modalAccent: theme.modalAccent,
          overlayBlur: theme.overlayBlur,
          fontFamily: theme.fontFamily,
        }
      : defaultTheme,
    tensionRange,
    recommendedStringProductIds,
    recommendedHybridStringProductIds,
  };
}
