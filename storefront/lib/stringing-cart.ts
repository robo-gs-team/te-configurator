import type { StorefrontConfigurator } from "~/lib/configurator.types";
import type { BedSelection, StringProduct } from "./string-catalog";
import {
  bedSummary,
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
    properties.Setup = bedSummary(catalog, standardBed);
    appendBedProperties(properties, catalog, standardBed, "");
  } else {
    properties.Mains = bedSummary(catalog, hybridBeds.mains);
    properties.Crosses = bedSummary(catalog, hybridBeds.crosses);
    appendBedProperties(properties, catalog, hybridBeds.mains, "Mains ");
    appendBedProperties(properties, catalog, hybridBeds.crosses, "Crosses ");
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
