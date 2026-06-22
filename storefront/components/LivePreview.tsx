import { useEffect, useMemo, useState } from "react";
import { getPreviewColors, getPreviewLayers } from "~/lib/conditional-logic";
import { useConfiguratorStore } from "../store/configurator-store";

export function LivePreview() {
  const configurator = useConfiguratorStore((s) => s.configurator);
  const selections = useConfiguratorStore((s) => s.selections);
  const layers = useMemo(
    () => (configurator ? getPreviewLayers(configurator, selections) : []),
    [configurator, selections],
  );
  const colors = useMemo(
    () => (configurator ? getPreviewColors(configurator, selections) : []),
    [configurator, selections],
  );
  const layersKey = layers.join("|");
  const accent = configurator?.theme.modalAccent ?? "#6366f1";
  const [loaded, setLoaded] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setLoaded(new Set());
  }, [layersKey]);

  const handleLoad = (url: string) => {
    setLoaded((prev) => {
      if (prev.has(url)) return prev;
      const next = new Set(prev);
      next.add(url);
      return next;
    });
  };

  return (
    <div className="relative w-full aspect-square max-h-[420px] rounded-2xl overflow-hidden bg-gradient-to-br from-neutral-900 to-neutral-800">
      <div
        className="absolute inset-0 opacity-30"
        style={{
          background: `radial-gradient(circle at 30% 30%, ${accent}40, transparent 60%)`,
        }}
      />
      {layers.length === 0 && colors.length === 0 ? (
        <div className="absolute inset-0 flex items-center justify-center text-white/40 text-sm">
          Select options to preview
        </div>
      ) : layers.length > 0 ? (
        layers.map((url, i) => (
          <img
            key={`${url}-${i}`}
            src={url}
            alt=""
            className="absolute inset-0 w-full h-full object-contain p-6 transition-opacity duration-300 ease-out"
            style={{ opacity: loaded.has(url) ? 1 : 0 }}
            onLoad={() => handleLoad(url)}
            loading="eager"
          />
        ))
      ) : (
        <div className="absolute inset-0 flex items-center justify-center gap-4 p-8">
          {colors.map((hex, i) => (
            <span
              key={`${hex}-${i}`}
              className="w-28 h-28 rounded-full border-4 border-white/20 shadow-2xl"
              style={{ backgroundColor: hex }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
