import { STEPS, useConfiguratorStore } from "../store/configurator-store";

const STEP_LABELS: Record<string, string> = {
  variant: "Configure",
  preview: "Preview",
  addons: "Add-ons",
  summary: "Summary",
  cart: "Cart",
};

export function ProgressBar() {
  const stepIndex = useConfiguratorStore((s) => s.stepIndex);
  const configurator = useConfiguratorStore((s) => s.configurator);
  const accent = configurator?.theme.modalAccent ?? "#6366f1";

  return (
    <div className="px-6 py-4">
      <div className="flex items-center gap-2 mb-2">
        {STEPS.map((step, i) => (
          <div key={step} className="flex items-center flex-1">
            <div className="h-1 flex-1 rounded-full overflow-hidden bg-white/10">
              <div
                className="h-full rounded-full proto-progress-fill"
                style={{
                  backgroundColor: accent,
                  width: i <= stepIndex ? "100%" : "0%",
                }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="flex justify-between text-xs text-white/50">
        {STEPS.map((step, i) => (
          <span
            key={step}
            className={i <= stepIndex ? "text-white/90 font-medium" : ""}
          >
            {STEP_LABELS[step]}
          </span>
        ))}
      </div>
    </div>
  );
}
