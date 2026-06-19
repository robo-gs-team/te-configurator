import type { StorefrontConfigurator } from "~/lib/configurator.types";
import type { BedSelection, StringProduct } from "./string-catalog";
import {
  bedSummary,
  formatStringPrice,
  getStringById,
  resolveStringCatalog,
} from "./string-catalog";
import type { HybridStep, StringingMode } from "../store/configurator-store";

export function buildStringingProperties(
  configurator: StorefrontConfigurator,
  mode: StringingMode,
  standardBed: BedSelection,
  hybridBeds: { mains: BedSelection; crosses: BedSelection },
): Record<string, string> {
  const catalog = resolveStringCatalog(configurator);
  const properties: Record<string, string> = {
    _configurator_id: configurator.id,
    _configurator_name: configurator.name,
    "Stringing mode": mode === "standard" ? "Standard" : "Hybrid",
  };

  if (mode === "standard") {
    const product = getStringById(catalog, standardBed.stringId);
    properties.Setup = bedSummary(catalog, standardBed);
    properties["String upgrade"] = formatStringPrice(product?.price ?? 0);
    appendBedProperties(properties, catalog, standardBed, "");
  } else {
    const mainsProduct = getStringById(catalog, hybridBeds.mains.stringId);
    const crossesProduct = getStringById(catalog, hybridBeds.crosses.stringId);
    properties.Mains = bedSummary(catalog, hybridBeds.mains);
    properties.Crosses = bedSummary(catalog, hybridBeds.crosses);
    properties["Mains upgrade"] = formatStringPrice(mainsProduct?.price ?? 0);
    properties["Crosses upgrade"] = formatStringPrice(crossesProduct?.price ?? 0);
    appendBedProperties(properties, catalog, hybridBeds.mains, "Mains ");
    appendBedProperties(properties, catalog, hybridBeds.crosses, "Crosses ");
  }

  if (configurator.laborPrice > 0) {
    properties.Labor = `$${configurator.laborPrice.toFixed(2)}`;
  }

  return properties;
}

function appendBedProperties(
  properties: Record<string, string>,
  catalog: StringProduct[],
  bed: BedSelection,
  prefix: string,
) {
  const product = getStringById(catalog, bed.stringId);
  if (!product) return;
  properties[`${prefix}String`] = product.name;
  properties[`${prefix}Gauge`] = `${bed.gauge}g`;
  properties[`${prefix}Color`] = bed.color;
  properties[`${prefix}Tension`] = `${bed.tension} lbs`;
}

export function hybridStepLabel(step: HybridStep): string {
  switch (step) {
    case "mains":
      return "Mains";
    case "crosses":
      return "Crosses";
    case "review":
      return "Review";
  }
}
