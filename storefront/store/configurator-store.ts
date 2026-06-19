import { create } from "zustand";
import type {
  SelectionState,
  StorefrontConfigurator,
} from "~/lib/configurator.types";
import {
  calculatePrice,
  getDefaultSelections,
  getPreviewLayers,
  getSelectedVariantId,
} from "~/lib/conditional-logic";
import type { BedSelection } from "../lib/string-catalog";
import {
  defaultBed,
  defaultHybridBeds,
  getStringById,
  resolveStringCatalog,
  usesStringingUi,
} from "../lib/string-catalog";

export type ConfiguratorStep = "variant" | "preview" | "addons" | "summary" | "cart";
export type StringingMode = "standard" | "hybrid";
export type HybridStep = "mains" | "crosses" | "review";

interface ConfiguratorStore {
  isOpen: boolean;
  productId: string | null;
  configurator: StorefrontConfigurator | null;
  currentStep: ConfiguratorStep;
  stepIndex: number;
  selections: SelectionState;
  addonSelections: Record<string, number>;
  isAddingToCart: boolean;
  cartError: string | null;
  shareUrl: string | null;
  stringingMode: StringingMode;
  hybridStep: HybridStep;
  standardBed: BedSelection;
  hybridBeds: { mains: BedSelection; crosses: BedSelection };

  open: (productId: string, configurator: StorefrontConfigurator) => void;
  close: () => void;
  setStep: (step: ConfiguratorStep) => void;
  nextStep: () => void;
  prevStep: () => void;
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
  setHybridStep: (step: HybridStep) => void;
  updateStandardBed: (patch: Partial<BedSelection>) => void;
  updateHybridBed: (side: "mains" | "crosses", patch: Partial<BedSelection>) => void;

  getPrice: () => ReturnType<typeof calculatePrice>;
  getStringingTotal: () => number;
  getLayers: () => string[];
  getVariantId: () => string | null;
}

const STEPS: ConfiguratorStep[] = [
  "variant",
  "preview",
  "addons",
  "summary",
  "cart",
];

export const useConfiguratorStore = create<ConfiguratorStore>()((set, get) => ({
      isOpen: false,
      productId: null,
      configurator: null,
      currentStep: "variant",
      stepIndex: 0,
      selections: {},
      addonSelections: {},
      isAddingToCart: false,
      cartError: null,
      shareUrl: null,
      stringingMode: "standard",
      hybridStep: "mains",
      standardBed: defaultBed(resolveStringCatalog(null)),
      hybridBeds: defaultHybridBeds(resolveStringCatalog(null)),

      open: (productId, configurator) => {
        const saved = get();
        const sameProduct =
          saved.productId === productId &&
          saved.configurator?.id === configurator.id;
        const catalog = resolveStringCatalog(configurator);
        set({
          isOpen: true,
          productId,
          configurator,
          currentStep: "variant",
          stepIndex: 0,
          selections: sameProduct
            ? saved.selections
            : getDefaultSelections(configurator),
          addonSelections: sameProduct ? saved.addonSelections : {},
          cartError: null,
          shareUrl: null,
          stringingMode: sameProduct ? saved.stringingMode : "standard",
          hybridStep: sameProduct ? saved.hybridStep : "mains",
          standardBed: sameProduct
            ? saved.standardBed
            : defaultBed(catalog),
          hybridBeds: sameProduct
            ? saved.hybridBeds
            : defaultHybridBeds(catalog),
        });
      },

      close: () => set({ isOpen: false, cartError: null }),

      setStep: (step) => {
        const idx = STEPS.indexOf(step);
        set({ currentStep: step, stepIndex: idx >= 0 ? idx : 0 });
      },

      nextStep: () => {
        const { stepIndex } = get();
        if (stepIndex < STEPS.length - 1) {
          set({
            stepIndex: stepIndex + 1,
            currentStep: STEPS[stepIndex + 1],
          });
        }
      },

      prevStep: () => {
        const { stepIndex } = get();
        if (stepIndex > 0) {
          set({
            stepIndex: stepIndex - 1,
            currentStep: STEPS[stepIndex - 1],
          });
        }
      },

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
        set({ selections, addonSelections: addons, currentStep: "summary", stepIndex: 3 });
      },

      setAddingToCart: (v) => set({ isAddingToCart: v }),
      setCartError: (err) => set({ cartError: err }),
      setShareUrl: (url) => set({ shareUrl: url }),

      setStringingMode: (mode) => set({ stringingMode: mode }),

      setHybridStep: (step) => set({ hybridStep: step }),

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
        const { configurator, stringingMode, standardBed, hybridBeds } = get();
        if (!configurator) return 0;
        const catalog = resolveStringCatalog(configurator);
        let total = configurator.basePrice;

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
        const { configurator, selections, addonSelections, stringingMode } = get();
        if (!configurator)
          return { base: 0, options: [], addons: [], total: 0 };
        const breakdown = calculatePrice(configurator, selections, addonSelections);
        if (usesStringingUi(configurator)) {
          return { ...breakdown, total: get().getStringingTotal() };
        }
        return breakdown;
      },

      getLayers: () => {
        const { configurator, selections } = get();
        if (!configurator) return [];
        return getPreviewLayers(configurator, selections);
      },

      getVariantId: () => {
        const { configurator, selections } = get();
        if (!configurator) return null;
        if (usesStringingUi(configurator)) return null;
        return getSelectedVariantId(configurator, selections);
      },
    }));

export { STEPS };
