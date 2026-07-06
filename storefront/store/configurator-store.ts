import { create } from "zustand";
import type {
  SelectionState,
  StorefrontConfigurator,
} from "~/lib/configurator.types";
import {
  calculatePrice,
  getDefaultSelections,
  getSelectedVariantId,
} from "~/lib/conditional-logic";
import type { BedSelection } from "../lib/string-catalog";
import {
  DEFAULT_TENSION_RANGE,
  defaultBed,
  defaultHybridBeds,
  getStringById,
  resolveStringCatalog,
  usesStringingUi,
} from "../lib/string-catalog";
import { getProductPriceFromPage } from "../lib/cart";

export type StringingMode = "standard" | "hybrid";

interface ConfiguratorStore {
  isOpen: boolean;
  productId: string | null;
  configurator: StorefrontConfigurator | null;
  // The live racquet price read from the product page at open() time; drives the "Racquet" line
  // and total instead of a manually-entered base price. Null when the page price can't be read.
  racquetPrice: number | null;
  selections: SelectionState;
  addonSelections: Record<string, number>;
  isAddingToCart: boolean;
  cartError: string | null;
  shareUrl: string | null;
  stringingMode: StringingMode;
  standardBed: BedSelection;
  hybridBeds: { mains: BedSelection; crosses: BedSelection };

  open: (productId: string, configurator: StorefrontConfigurator) => void;
  close: () => void;
  selectOption: (groupId: string, optionId: string) => void;
  toggleAddon: (addonId: string) => void;
  setAddonQuantity: (addonId: string, qty: number) => void;
  restoreFromShare: (
    selections: SelectionState,
    addons: Record<string, number>,
  ) => void;
  setAddingToCart: (v: boolean) => void;
  setCartError: (err: string | null) => void;
  setShareUrl: (url: string | null) => void;
  setStringingMode: (mode: StringingMode) => void;
  updateStandardBed: (patch: Partial<BedSelection>) => void;
  updateHybridBed: (side: "mains" | "crosses", patch: Partial<BedSelection>) => void;

  getPrice: () => ReturnType<typeof calculatePrice>;
  getStringingTotal: () => number;
  getVariantId: () => string | null;
}

export const useConfiguratorStore = create<ConfiguratorStore>()((set, get) => ({
      isOpen: false,
      productId: null,
      configurator: null,
      racquetPrice: null,
      selections: {},
      addonSelections: {},
      isAddingToCart: false,
      cartError: null,
      shareUrl: null,
      stringingMode: "standard",
      standardBed: defaultBed(resolveStringCatalog(null), DEFAULT_TENSION_RANGE),
      hybridBeds: defaultHybridBeds(resolveStringCatalog(null), DEFAULT_TENSION_RANGE),

      open: (productId, configurator) => {
        const saved = get();
        const sameProduct =
          saved.productId === productId &&
          saved.configurator?.id === configurator.id;
        const catalog = resolveStringCatalog(configurator);
        const tensionRange = configurator.tensionRange ?? DEFAULT_TENSION_RANGE;
        set({
          isOpen: true,
          productId,
          configurator,
          racquetPrice: getProductPriceFromPage(),
          selections: sameProduct
            ? saved.selections
            : getDefaultSelections(configurator),
          addonSelections: sameProduct ? saved.addonSelections : {},
          cartError: null,
          shareUrl: null,
          stringingMode: sameProduct ? saved.stringingMode : "standard",
          standardBed: sameProduct
            ? saved.standardBed
            : defaultBed(catalog, tensionRange),
          hybridBeds: sameProduct
            ? saved.hybridBeds
            : defaultHybridBeds(catalog, tensionRange),
        });
      },

      close: () => set({ isOpen: false, cartError: null }),

      selectOption: (groupId, optionId) => {
        set((s) => ({
          selections: { ...s.selections, [groupId]: optionId },
        }));
      },

      toggleAddon: (addonId) => {
        set((s) => {
          const current = s.addonSelections[addonId] ?? 0;
          return {
            addonSelections: {
              ...s.addonSelections,
              [addonId]: current > 0 ? 0 : 1,
            },
          };
        });
      },

      setAddonQuantity: (addonId, qty) => {
        set((s) => ({
          addonSelections: { ...s.addonSelections, [addonId]: Math.max(0, qty) },
        }));
      },

      restoreFromShare: (selections, addons) => {
        set({ selections, addonSelections: addons });
      },

      setAddingToCart: (v) => set({ isAddingToCart: v }),
      setCartError: (err) => set({ cartError: err }),
      setShareUrl: (url) => set({ shareUrl: url }),

      setStringingMode: (mode) => set({ stringingMode: mode }),

      updateStandardBed: (patch) =>
        set((s) => ({ standardBed: { ...s.standardBed, ...patch } })),

      updateHybridBed: (side, patch) =>
        set((s) => ({
          hybridBeds: {
            ...s.hybridBeds,
            [side]: { ...s.hybridBeds[side], ...patch },
          },
        })),

      getStringingTotal: () => {
        const { configurator, stringingMode, standardBed, hybridBeds, racquetPrice } = get();
        if (!configurator) return 0;
        const catalog = resolveStringCatalog(configurator);
        // Prefer the live racquet price from the page; fall back to the stored base price.
        let total = racquetPrice ?? configurator.basePrice;

        if (stringingMode === "standard") {
          const product = getStringById(catalog, standardBed.stringId);
          total += product?.price ?? 0;
        } else {
          const mains = getStringById(catalog, hybridBeds.mains.stringId);
          const crosses = getStringById(catalog, hybridBeds.crosses.stringId);
          total += (mains?.price ?? 0) + (crosses?.price ?? 0);
        }

        total += configurator.laborPrice ?? 0;

        return total;
      },

      getPrice: () => {
        const { configurator, selections, addonSelections } = get();
        if (!configurator)
          return { base: 0, options: [], addons: [], total: 0 };
        const breakdown = calculatePrice(configurator, selections, addonSelections);
        if (usesStringingUi(configurator)) {
          return { ...breakdown, total: get().getStringingTotal() };
        }
        return breakdown;
      },

      getVariantId: () => {
        const { configurator, selections } = get();
        if (!configurator) return null;
        if (usesStringingUi(configurator)) return null;
        return getSelectedVariantId(configurator, selections);
      },
    }));
