import { evaluateRules, getVisibleAddons } from "~/lib/conditional-logic";
import type { StorefrontOptionGroup } from "~/lib/configurator.types";
import { useConfiguratorStore } from "../store/configurator-store";

function SwatchOption({
  group,
  option,
  selected,
  onSelect,
  accent,
}: {
  group: StorefrontOptionGroup;
  option: StorefrontOptionGroup["options"][0];
  selected: boolean;
  onSelect: () => void;
  accent: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`proto-swatch-press relative flex flex-col items-center gap-2 p-3 rounded-xl transition-all ${
        selected ? "proto-glass" : "bg-white/5 hover:bg-white/10"
      }`}
      style={selected ? { border: `2px solid ${accent}` } : undefined}
      title={option.label}
    >
      {option.colorHex ? (
        <span
          className="w-10 h-10 rounded-full border-2 border-white/20 shadow-lg"
          style={{ backgroundColor: option.colorHex }}
        />
      ) : option.imageUrl ? (
        <img
          src={option.imageUrl}
          alt={option.label}
          className="w-14 h-14 rounded-lg object-cover"
        />
      ) : (
        <span className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center text-xs">
          {option.label.slice(0, 2)}
        </span>
      )}
      <span className="text-xs text-white/80 font-medium">{option.label}</span>
      {option.priceAdjust !== 0 && (
        <span className="text-[10px] text-white/50">
          {option.priceAdjust > 0 ? "+" : ""}${option.priceAdjust.toFixed(0)}
        </span>
      )}
    </button>
  );
}

function CardOption({
  option,
  selected,
  onSelect,
  accent,
}: {
  option: StorefrontOptionGroup["options"][0];
  selected: boolean;
  onSelect: () => void;
  accent: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`proto-lift w-full text-left p-4 rounded-2xl transition-all ${
        selected ? "proto-glass" : "bg-white/5 hover:bg-white/10"
      }`}
      style={selected ? { borderColor: accent, borderWidth: 2 } : undefined}
    >
      <div className="flex items-center gap-4">
        {option.imageUrl && (
          <img
            src={option.imageUrl}
            alt=""
            className="w-16 h-16 rounded-xl object-cover"
          />
        )}
        <div>
          <p className="font-semibold text-white">{option.label}</p>
          {option.priceAdjust !== 0 && (
            <p className="text-sm text-white/50 mt-0.5">
              {option.priceAdjust > 0 ? "+" : ""}${option.priceAdjust.toFixed(2)}
            </p>
          )}
        </div>
      </div>
    </button>
  );
}

export function VariantStep() {
  const configurator = useConfiguratorStore((s) => s.configurator);
  const selections = useConfiguratorStore((s) => s.selections);
  const selectOption = useConfiguratorStore((s) => s.selectOption);
  const accent = configurator?.theme.modalAccent ?? "#6366f1";

  if (!configurator) return null;

  const rules = evaluateRules(configurator.rules, selections);

  return (
    <div className="space-y-8 pr-2">
      {configurator.steps
        .filter(
          (s) =>
            s.optionGroups.length > 0 &&
            s.stepType !== "preview" &&
            s.stepType !== "summary",
        )
        .map((step) => (
          <div key={step.id}>
            <h3 className="text-lg font-semibold text-white mb-1">{step.title}</h3>
            {step.description && (
              <p className="text-sm text-white/50 mb-4">{step.description}</p>
            )}
            {step.optionGroups.map((group) => (
              <div key={group.id} className="mb-6">
                <p className="text-sm font-medium text-white/70 mb-3">{group.name}</p>
                {group.displayType === "card" ? (
                  <div className="grid gap-3">
                    {group.options
                      .filter((o) => !rules.hiddenOptions.has(o.id))
                      .map((option) => (
                        <CardOption
                          key={option.id}
                          option={option}
                          selected={selections[group.id] === option.id}
                          onSelect={() => selectOption(group.id, option.id)}
                          accent={accent}
                        />
                      ))}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-3">
                    {group.options
                      .filter((o) => !rules.hiddenOptions.has(o.id))
                      .map((option) => (
                        <SwatchOption
                          key={option.id}
                          group={group}
                          option={option}
                          selected={selections[group.id] === option.id}
                          onSelect={() => selectOption(group.id, option.id)}
                          accent={accent}
                        />
                      ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
    </div>
  );
}

export function AddonsStep() {
  const configurator = useConfiguratorStore((s) => s.configurator);
  const selections = useConfiguratorStore((s) => s.selections);
  const addonSelections = useConfiguratorStore((s) => s.addonSelections);
  const toggleAddon = useConfiguratorStore((s) => s.toggleAddon);
  const setAddonQuantity = useConfiguratorStore((s) => s.setAddonQuantity);
  const accent = configurator?.theme.modalAccent ?? "#6366f1";

  if (!configurator) return null;

  const rules = evaluateRules(configurator.rules, selections);
  const addons = getVisibleAddons(configurator.addons, rules);

  if (addons.length === 0) {
    return (
      <p className="text-white/50 text-center py-12">No add-ons available</p>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {addons.map((addon) => {
        const qty = addonSelections[addon.id] ?? 0;
        const selected = qty > 0;
        return (
          <div
            key={addon.id}
            className={`proto-lift p-4 rounded-2xl cursor-pointer transition-all ${
              selected ? "proto-glass" : "bg-white/5 hover:bg-white/10"
            }`}
            style={selected ? { borderColor: accent, borderWidth: 2 } : undefined}
            onClick={() => toggleAddon(addon.id)}
          >
            <div className="flex gap-4">
              {addon.imageUrl && (
                <img
                  src={addon.imageUrl}
                  alt=""
                  className="w-20 h-20 rounded-xl object-cover"
                />
              )}
              <div className="flex-1">
                <p className="font-semibold text-white">{addon.name}</p>
                {addon.description && (
                  <p className="text-sm text-white/50 mt-1">{addon.description}</p>
                )}
                <p className="text-sm font-medium mt-2" style={{ color: accent }}>
                  +${addon.price.toFixed(2)}
                </p>
                {selected && addon.maxQuantity > 1 && (
                  <div
                    className="flex items-center gap-2 mt-3"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      className="w-8 h-8 rounded-lg bg-white/10 text-white"
                      onClick={() => setAddonQuantity(addon.id, qty - 1)}
                    >
                      −
                    </button>
                    <span className="text-white w-6 text-center">{qty}</span>
                    <button
                      type="button"
                      className="w-8 h-8 rounded-lg bg-white/10 text-white"
                      onClick={() =>
                        setAddonQuantity(addon.id, Math.min(addon.maxQuantity, qty + 1))
                      }
                    >
                      +
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
