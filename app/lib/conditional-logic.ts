import type {
  SelectionState,
  StorefrontAddon,
  StorefrontConfigurator,
  StorefrontRule,
} from "./configurator.types";

export type PriceBreakdown = {
  base: number;
  options: { label: string; amount: number }[];
  addons: { label: string; amount: number; quantity: number }[];
  total: number;
};

export type RuleEvaluation = {
  hiddenAddons: Set<string>;
  visibleAddons: Set<string>;
  priceAdjustments: number;
  hiddenOptions: Set<string>;
};

function evaluateCondition(
  op: string,
  actual: string,
  expected: string,
): boolean {
  switch (op) {
    case "equals":
      return actual === expected;
    case "not_equals":
      return actual !== expected;
    case "contains":
      return actual.includes(expected);
    default:
      return actual === expected;
  }
}

export function evaluateRules(
  rules: StorefrontRule[],
  selections: SelectionState,
): RuleEvaluation {
  const result: RuleEvaluation = {
    hiddenAddons: new Set(),
    visibleAddons: new Set(),
    priceAdjustments: 0,
    hiddenOptions: new Set(),
  };

  for (const rule of rules) {
    const actual = selections[rule.conditionField] ?? "";
    if (!evaluateCondition(rule.conditionOp, actual, rule.conditionValue)) {
      continue;
    }

    switch (rule.actionType) {
      case "show_addon":
        if (rule.actionTarget) result.visibleAddons.add(rule.actionTarget);
        break;
      case "hide_addon":
        if (rule.actionTarget) result.hiddenAddons.add(rule.actionTarget);
        break;
      case "hide_option":
        if (rule.actionTarget) result.hiddenOptions.add(rule.actionTarget);
        break;
      case "price_adjust":
        result.priceAdjustments += Number(rule.actionValue.amount ?? 0);
        break;
    }
  }

  return result;
}

export function getVisibleAddons(
  addons: StorefrontAddon[],
  rules: RuleEvaluation,
): StorefrontAddon[] {
  return addons.filter((addon) => {
    if (rules.hiddenAddons.has(addon.id)) return false;
    if (rules.visibleAddons.size > 0 && !rules.visibleAddons.has(addon.id)) {
      const hasShowRules = rules.visibleAddons.size > 0;
      const addonHasShowRule = [...rules.visibleAddons].some((id) =>
        addons.some((a) => a.id === id),
      );
      if (hasShowRules && addonHasShowRule && !rules.visibleAddons.has(addon.id)) {
        return false;
      }
    }
    return true;
  });
}

export function calculatePrice(
  configurator: StorefrontConfigurator,
  selections: SelectionState,
  addonSelections: Record<string, number>,
): PriceBreakdown {
  const rules = evaluateRules(configurator.rules, selections);
  let total = configurator.basePrice + rules.priceAdjustments;
  const optionLines: PriceBreakdown["options"] = [];
  const addonLines: PriceBreakdown["addons"] = [];

  for (const step of configurator.steps) {
    for (const group of step.optionGroups) {
      const selectedId = selections[group.id];
      const option = group.options.find((o) => o.id === selectedId);
      if (option && option.priceAdjust !== 0) {
        optionLines.push({ label: option.label, amount: option.priceAdjust });
        total += option.priceAdjust;
      }
    }
  }

  const visibleAddons = getVisibleAddons(configurator.addons, rules);
  for (const addon of visibleAddons) {
    const qty = addonSelections[addon.id] ?? 0;
    if (qty > 0) {
      const amount = addon.price * qty;
      addonLines.push({ label: addon.name, amount, quantity: qty });
      total += amount;
    }
  }

  return {
    base: configurator.basePrice + rules.priceAdjustments,
    options: optionLines,
    addons: addonLines,
    total,
  };
}

export function getPreviewLayers(
  configurator: StorefrontConfigurator,
  selections: SelectionState,
): string[] {
  const layers: string[] = [];

  for (const step of configurator.steps) {
    for (const group of step.optionGroups) {
      const selectedId = selections[group.id];
      const option = group.options.find((o) => o.id === selectedId);
      if (option?.previewLayer) layers.push(option.previewLayer);
      else if (option?.imageUrl) layers.push(option.imageUrl);
    }
  }

  return layers;
}

export function getPreviewColors(
  configurator: StorefrontConfigurator,
  selections: SelectionState,
): string[] {
  const colors: string[] = [];

  for (const step of configurator.steps) {
    for (const group of step.optionGroups) {
      const selectedId = selections[group.id];
      const option = group.options.find((o) => o.id === selectedId);
      if (option?.colorHex) colors.push(option.colorHex);
    }
  }

  return colors;
}

export function getSelectedVariantId(
  configurator: StorefrontConfigurator,
  selections: SelectionState,
): string | null {
  for (const step of configurator.steps) {
    for (const group of step.optionGroups) {
      const selectedId = selections[group.id];
      const option = group.options.find((o) => o.id === selectedId);
      if (option?.variantId) return option.variantId;
    }
  }
  return null;
}

export function buildLineItemProperties(
  configurator: StorefrontConfigurator,
  selections: SelectionState,
  addonSelections: Record<string, number>,
): Record<string, string> {
  const properties: Record<string, string> = {
    _configurator_id: configurator.id,
    _configurator_name: configurator.name,
  };

  for (const step of configurator.steps) {
    for (const group of step.optionGroups) {
      const selectedId = selections[group.id];
      const option = group.options.find((o) => o.id === selectedId);
      if (option) {
        properties[group.name] = option.label;
      }
    }
  }

  const addonLabels: string[] = [];
  for (const addon of configurator.addons) {
    const qty = addonSelections[addon.id] ?? 0;
    if (qty > 0) addonLabels.push(`${addon.name} x${qty}`);
  }
  if (addonLabels.length) properties["Add-ons"] = addonLabels.join(", ");

  return properties;
}

export function getDefaultSelections(
  configurator: StorefrontConfigurator,
): SelectionState {
  const selections: SelectionState = {};
  for (const step of configurator.steps) {
    for (const group of step.optionGroups) {
      const defaultOption =
        group.options.find((o) => o.isDefault) ?? group.options[0];
      if (defaultOption) selections[group.id] = defaultOption.id;
    }
  }
  return selections;
}

export function sanitizeInput(value: string, maxLength = 500): string {
  return value
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, maxLength);
}
