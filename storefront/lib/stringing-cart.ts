import type { StorefrontConfigurator } from "~/lib/configurator.types";
import type { BedSelection, StringProduct } from "./string-catalog";
import {
  bedSummary,
  formatStringPrice,
  getStringById,
  resolveStringCatalog,
} from "./string-catalog";
import type { StringingMode } from "../store/configurator-store";

/**
 * Customer-visible on the racquet line: just `Stringing mode` + one summary line per bed
 * (`Setup`, or `Mains`/`Crosses`) — enough for the shopper to recognize their own order at a
 * glance. Everything else (per-side String/Gauge/Color/Tension breakdown, upgrade price notes,
 * the Labor note) is staff-only (leading underscore): still fully visible to whoever strings/
 * fulfills the racquet on the Shopify Admin order page, just not surfaced to the customer in the
 * cart, checkout, order-status page, or confirmation email. Hiding these loses no pricing
 * transparency — the string and labor charges are already their own separate cart lines with
 * their own real Shopify-displayed prices; these were only a duplicate textual restatement.
 */
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
    properties["_String upgrade"] = formatStringPrice(product?.price ?? 0);
    appendBedProperties(properties, catalog, standardBed, "_");
  } else {
    const mainsProduct = getStringById(catalog, hybridBeds.mains.stringId);
    const crossesProduct = getStringById(catalog, hybridBeds.crosses.stringId);
    properties.Mains = bedSummary(catalog, hybridBeds.mains);
    properties.Crosses = bedSummary(catalog, hybridBeds.crosses);
    properties["_Mains upgrade"] = formatStringPrice(mainsProduct?.price ?? 0);
    properties["_Crosses upgrade"] = formatStringPrice(crossesProduct?.price ?? 0);
    appendBedProperties(properties, catalog, hybridBeds.mains, "_Mains ");
    appendBedProperties(properties, catalog, hybridBeds.crosses, "_Crosses ");
  }

  if (configurator.laborPrice > 0) {
    properties._Labor = `$${configurator.laborPrice.toFixed(2)}`;
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
