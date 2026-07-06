import { useMemo, useState } from "react";
import { useConfiguratorStore } from "../store/configurator-store";
import type { BedSelection, StringProduct, TensionRange } from "../lib/string-catalog";
import {
  crossesFromMains,
  DEFAULT_TENSION_RANGE,
  formatStringPrice,
  getStringById,
  resolveStringCatalog,
  SWATCH_COLORS,
} from "../lib/string-catalog";

const FILTER_CHIPS = [
  { id: "all", label: "All" },
  { id: "Polyester", label: "Polyester" },
  { id: "Multifilament", label: "Multifilament" },
  { id: "Natural gut", label: "Natural Gut" },
  { id: "Synthetic gut", label: "Synthetic Gut" },
] as const;

const STRING_REEL = (
  <svg viewBox="0 0 36 36" fill="none" className="w-9 h-9">
    <circle cx="18" cy="18" r="13" stroke="#9ca3af" strokeWidth="1.5" />
    <circle cx="18" cy="18" r="6" stroke="#9ca3af" strokeWidth="1.5" />
    <line x1="18" y1="5" x2="18" y2="12" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" />
    <line x1="18" y1="24" x2="18" y2="31" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" />
    <line x1="5" y1="18" x2="12" y2="18" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" />
    <line x1="24" y1="18" x2="31" y2="18" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

function StringImage({ product }: { product: StringProduct }) {
  if (product.imageUrl) {
    return (
      <img
        src={product.imageUrl}
        alt={product.name}
        className="w-9 h-9 object-cover rounded"
        loading="lazy"
      />
    );
  }
  return STRING_REEL;
}

type Accent = "standard" | "mains" | "crosses";

function tensionPercent(value: number, range: TensionRange) {
  return ((value - range.min) / (range.max - range.min)) * 100;
}

function normalizeBed(product: StringProduct, bed: BedSelection): BedSelection {
  return {
    stringId: product.id,
    gauge: product.gauges.includes(bed.gauge) ? bed.gauge : product.gauges[0],
    color: product.colors.includes(bed.color) ? bed.color : product.colors[0],
    tension: bed.tension,
  };
}

// Page size for the string list's "Show more" pagination — keeps the initial render short even
// when a merchant's catalog has dozens of strings, without hiding anything behind a filter.
const STRING_PAGE_SIZE = 20;

function filterCatalog(catalog: StringProduct[], filter: string, search: string) {
  const query = search.trim().toLowerCase();
  const matching = catalog.filter((s) => {
    if (filter !== "all" && s.type !== filter) return false;
    if (query && !`${s.name} ${s.type}`.toLowerCase().includes(query)) return false;
    return true;
  });
  // Array.prototype.sort is stable (ES2019+), so this only moves recommended items to the
  // front — it doesn't otherwise reorder the merchant's original catalog order.
  return [...matching].sort((a, b) => Number(Boolean(b.recommended)) - Number(Boolean(a.recommended)));
}

function ModeToggle() {
  const mode = useConfiguratorStore((s) => s.stringingMode);
  const setMode = useConfiguratorStore((s) => s.setStringingMode);

  return (
    <div className="proto-desk-mode-toggle">
      <button
        type="button"
        className={`proto-desk-mode-btn ${mode === "standard" ? "proto-desk-mode-btn--std" : ""}`}
        onClick={() => setMode("standard")}
      >
        Standard
      </button>
      <button
        type="button"
        className={`proto-desk-mode-btn ${mode === "hybrid" ? "proto-desk-mode-btn--hybrid" : ""}`}
        onClick={() => setMode("hybrid")}
      >
        Hybrid
      </button>
    </div>
  );
}

function StringCatalog({
  catalog,
  selectedId,
  accent,
  onSelect,
}: {
  catalog: StringProduct[];
  selectedId: string;
  accent: "standard" | "mains" | "crosses";
  onSelect: (id: string) => void;
}) {
  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(STRING_PAGE_SIZE);
  const filtered = filterCatalog(catalog, filter, search);
  const visible = filtered.slice(0, visibleCount);
  const remaining = filtered.length - visible.length;
  const selectedClass =
    accent === "mains"
      ? "proto-desk-string-row--m"
      : accent === "crosses"
        ? "proto-desk-string-row--c"
        : "proto-desk-string-row--selected";

  const selectFilter = (id: string) => {
    setFilter(id);
    setVisibleCount(STRING_PAGE_SIZE);
  };

  const onSearch = (value: string) => {
    setSearch(value);
    setVisibleCount(STRING_PAGE_SIZE);
  };

  return (
    <>
      <input
        type="search"
        className="proto-desk-search"
        placeholder="Search strings…"
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        aria-label="Search strings"
      />
      <div className="proto-desk-chips">
        {FILTER_CHIPS.map((chip) => (
          <button
            key={chip.id}
            type="button"
            className={`proto-desk-chip ${filter === chip.id ? "proto-desk-chip--active" : ""}`}
            onClick={() => selectFilter(chip.id)}
          >
            {chip.label}
          </button>
        ))}
      </div>
      <div className="proto-desk-string-list">
        {visible.length === 0 && (
          <p className="proto-desk-string-empty">
            No strings match{search.trim() ? ` “${search.trim()}”` : " this filter"}.
          </p>
        )}
        {visible.map((product) => {
          const isSelected = product.id === selectedId;
          return (
            <button
              key={product.id}
              type="button"
              onClick={() => onSelect(product.id)}
              className={`proto-desk-string-row ${isSelected ? selectedClass : ""}`}
            >
              <div className="proto-desk-str-img">
                <StringImage product={product} />
              </div>
              <div className="proto-desk-str-info">
                {product.recommended && !isSelected && (
                  <span className="proto-desk-str-badge proto-desk-str-badge--rec">Recommended</span>
                )}
                {isSelected && accent === "mains" && (
                  <span className="proto-desk-str-badge proto-desk-str-badge--m">Selected</span>
                )}
                {isSelected && accent === "crosses" && (
                  <span className="proto-desk-str-badge proto-desk-str-badge--c">Selected</span>
                )}
                <p className="proto-desk-str-name">{product.name}</p>
                <p className="proto-desk-str-type">{product.type}</p>
              </div>
              <span
                className={`proto-desk-str-price ${
                  product.price === 0 ? "proto-desk-str-price--free" : ""
                }`}
              >
                {formatStringPrice(product.price)}
              </span>
            </button>
          );
        })}
      </div>
      {remaining > 0 && (
        <button
          type="button"
          className="proto-desk-load-more"
          onClick={() => setVisibleCount((count) => count + STRING_PAGE_SIZE)}
        >
          Show {Math.min(remaining, STRING_PAGE_SIZE)} more ({remaining} left)
        </button>
      )}
    </>
  );
}

function BedConfigFields({
  bed,
  product,
  accent,
  tensionTitle,
  tensionRange,
  recommendedTension,
  recommendedGauge,
  onChange,
}: {
  bed: BedSelection;
  product: StringProduct;
  accent: Accent;
  tensionTitle: string;
  tensionRange: TensionRange;
  recommendedTension: number;
  recommendedGauge: string;
  onChange: (bed: BedSelection) => void;
}) {
  const normalized = normalizeBed(product, bed);
  const pct = tensionPercent(normalized.tension, tensionRange);
  const recPct = tensionPercent(recommendedTension, tensionRange);
  const fillClass =
    accent === "mains"
      ? "proto-desk-slider-fill--m"
      : accent === "crosses"
        ? "proto-desk-slider-fill--c"
        : "proto-desk-slider-fill--std";
  const thumbClass =
    accent === "mains"
      ? "proto-desk-slider-thumb--m"
      : accent === "crosses"
        ? "proto-desk-slider-thumb--c"
        : "proto-desk-slider-thumb--std";
  const recClass =
    accent === "mains"
      ? "text-[#185FA5]"
      : accent === "crosses"
        ? "text-[#6D28D9]"
        : "text-[#C8102E]";

  return (
    <div className="space-y-3">
      <div>
        <p className="proto-desk-field-label">Gauge</p>
        <div className="proto-desk-seg">
          {product.gauges.map((g) => (
            <button
              key={g}
              type="button"
              className={`proto-desk-seg-opt ${g === normalized.gauge ? "proto-desk-seg-opt--sel" : ""}`}
              onClick={() => onChange({ ...normalized, gauge: g })}
            >
              {g}
            </button>
          ))}
        </div>
        <p className="proto-desk-dev-hint mt-1">
          Recommended: <span className={`font-bold ${recClass}`}>{recommendedGauge}g</span> for this
          racquet
        </p>
      </div>

      <div>
        <div className="flex items-center gap-1 mb-1.5">
          <span className="proto-desk-field-label mb-0">Color:</span>
          <span className="text-[10px] font-bold text-neutral-900">{normalized.color}</span>
        </div>
        <div className="proto-desk-swatches">
          {product.colors.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => onChange({ ...normalized, color })}
              className={`proto-desk-swatch ${color === normalized.color ? "proto-desk-swatch--sel" : ""}`}
              style={{
                background: SWATCH_COLORS[color] ?? "#ccc",
                border: color === "White" || color === "Natural" ? "1.5px solid #888" : undefined,
              }}
              title={color}
            />
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-baseline justify-between mb-0.5">
          <span className="text-[11px] font-bold text-neutral-900">{tensionTitle}</span>
          <div className="flex items-baseline gap-1">
            <span className="text-[13px] font-bold border-b border-dashed border-neutral-400">
              {normalized.tension}
            </span>
            <span className="text-[10px] text-neutral-500">lbs</span>
          </div>
        </div>
        <p className="text-[10px] text-neutral-500 mb-2">
          Recommended: <span className={`font-bold ${recClass}`}>{recommendedTension} lbs</span>
        </p>
        <div className="relative pt-1 pb-5">
          <input
            type="range"
            min={tensionRange.min}
            max={tensionRange.max}
            step={1}
            value={normalized.tension}
            onChange={(e) => onChange({ ...normalized, tension: Number(e.target.value) })}
            className="absolute inset-x-0 top-2 z-10 w-full h-5 opacity-0 cursor-pointer"
            aria-label={tensionTitle}
          />
          <div className="proto-desk-slider-track">
            <div className={`proto-desk-slider-fill ${fillClass}`} style={{ width: `${pct}%` }} />
            <div
              className={`proto-desk-slider-thumb ${thumbClass}`}
              style={{ left: `${pct}%` }}
            />
            <div
              className="absolute top-0 w-px h-2 -translate-x-1/2 pointer-events-none opacity-80"
              style={{ left: `${recPct}%`, background: accent === "mains" ? "#185FA5" : accent === "crosses" ? "#6D28D9" : "#C8102E" }}
            />
          </div>
          <div className="flex justify-between text-[9px] text-neutral-400 mt-1">
            <span>{tensionRange.min}</span>
            <span>{Math.round((tensionRange.min + tensionRange.max) / 2)}</span>
            <span>{tensionRange.max}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function SelectedCard({
  accent,
  eyebrow,
  name,
  sub,
}: {
  accent: Accent;
  eyebrow: string;
  name: string;
  sub: string;
}) {
  const cardClass =
    accent === "mains"
      ? "proto-desk-sel-card--m"
      : accent === "crosses"
        ? "proto-desk-sel-card--c"
        : "proto-desk-sel-card--std";
  const eyClass =
    accent === "mains"
      ? "text-[#185FA5]"
      : accent === "crosses"
        ? "text-[#6D28D9]"
        : "text-[#C8102E]";

  return (
    <div className={`proto-desk-sel-card ${cardClass}`}>
      <p className={`text-[9px] font-bold uppercase tracking-wide mb-1 ${eyClass}`}>{eyebrow}</p>
      <p className="text-[13px] font-bold text-neutral-900">{name}</p>
      <p className="text-[11px] text-neutral-500 mt-0.5">{sub}</p>
    </div>
  );
}

function OrderSummary({
  basePrice,
  stringLines,
  laborPrice,
  total,
}: {
  basePrice: number;
  stringLines: { label: string; value: string }[];
  laborPrice: number;
  total: number;
}) {
  return (
    <div className="space-y-1">
      <div className="proto-desk-sum-row">
        <span>Racquet</span>
        <span>${basePrice.toFixed(0)}</span>
      </div>
      {stringLines.map((line) => (
        <div key={line.label} className="proto-desk-sum-row">
          <span>{line.label}</span>
          <span>{line.value}</span>
        </div>
      ))}
      <div className="proto-desk-sum-row">
        <span>Labor</span>
        <span>{laborPrice > 0 ? `$${laborPrice.toFixed(0)}` : "Incl."}</span>
      </div>
      <div className="proto-desk-sum-total">
        <span>Total</span>
        <span>${total.toFixed(0)}</span>
      </div>
    </div>
  );
}

function TrustStrip() {
  return (
    <div className="proto-desk-trust">
      <div className="proto-desk-trust-item">
        <span className="proto-desk-trust-dot" aria-hidden>
          ✓
        </span>
        <div>
          <p className="proto-desk-trust-title">Same-day stringing</p>
          <p className="proto-desk-trust-sub">Order before 2pm CST</p>
        </div>
      </div>
      <div className="proto-desk-trust-item">
        <span className="proto-desk-trust-dot" aria-hidden>
          ✓
        </span>
        <div>
          <p className="proto-desk-trust-title">Strung to your exact specs</p>
          <p className="proto-desk-trust-sub">±0.5 lbs by USRSA technicians</p>
        </div>
      </div>
      <div className="proto-desk-trust-item">
        <span className="proto-desk-trust-dot" aria-hidden>
          ✓
        </span>
        <div>
          <p className="proto-desk-trust-title">Free restring if anything&apos;s wrong</p>
          <p className="proto-desk-trust-sub">No questions asked</p>
        </div>
      </div>
    </div>
  );
}

function AddToCartButton({
  total,
  onAddToCart,
  isAddingToCart,
}: {
  total: number;
  onAddToCart: () => void;
  isAddingToCart: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onAddToCart}
      disabled={isAddingToCart}
      className="proto-desk-atc-btn w-full disabled:opacity-60"
    >
      {isAddingToCart ? "Adding..." : `Add to Cart — $${total.toFixed(2)}`}
    </button>
  );
}

function StandardDesktop({
  catalog,
  basePrice,
  laborPrice,
  tensionRange,
  onAddToCart,
  isAddingToCart,
}: {
  catalog: StringProduct[];
  basePrice: number;
  laborPrice: number;
  tensionRange: TensionRange;
  onAddToCart: () => void;
  isAddingToCart: boolean;
}) {
  const bed = useConfiguratorStore((s) => s.standardBed);
  const update = useConfiguratorStore((s) => s.updateStandardBed);
  const setMode = useConfiguratorStore((s) => s.setStringingMode);
  const total = useConfiguratorStore((s) => s.getStringingTotal());

  const product = getStringById(catalog, bed.stringId) ?? catalog[0];
  const normalized = normalizeBed(product, bed);

  const setString = (id: string) => {
    const next = getStringById(catalog, id);
    if (!next) return;
    update(normalizeBed(next, normalized));
  };

  return (
    <div className="proto-desk-std-body">
      <div className="proto-desk-catalog">
        <p className="text-xs font-bold text-neutral-900 mb-2.5">Choose a string</p>
        <StringCatalog
          catalog={catalog}
          selectedId={normalized.stringId}
          accent="standard"
          onSelect={setString}
        />
        <div className="proto-desk-hybrid-cta-row">
          <span className="text-[11px] text-neutral-500">Advanced player?</span>
          <button type="button" className="proto-desk-hybrid-cta" onClick={() => setMode("hybrid")}>
            Build a hybrid setup →
          </button>
        </div>
      </div>

      <div className="proto-desk-config-panel">
        <p className="proto-desk-panel-title">Your configuration</p>
        <SelectedCard
          accent="standard"
          eyebrow="Strung with"
          name={product.name}
          sub={formatStringPrice(product.price)}
        />
        <BedConfigFields
          bed={normalized}
          product={product}
          accent="standard"
          tensionTitle="Tension"
          tensionRange={tensionRange}
          recommendedTension={tensionRange.recommended}
          recommendedGauge="16"
          onChange={update}
        />
        <div className="proto-desk-divider" />
        <OrderSummary
          basePrice={basePrice}
          stringLines={[{ label: "String", value: formatStringPrice(product.price) }]}
          laborPrice={laborPrice}
          total={total}
        />
        <AddToCartButton total={total} onAddToCart={onAddToCart} isAddingToCart={isAddingToCart} />
        <TrustStrip />
      </div>
    </div>
  );
}

function HybridDesktop({
  catalog,
  basePrice,
  laborPrice,
  tensionRange,
  onAddToCart,
  isAddingToCart,
}: {
  catalog: StringProduct[];
  basePrice: number;
  laborPrice: number;
  tensionRange: TensionRange;
  onAddToCart: () => void;
  isAddingToCart: boolean;
}) {
  const beds = useConfiguratorStore((s) => s.hybridBeds);
  const update = useConfiguratorStore((s) => s.updateHybridBed);
  const total = useConfiguratorStore((s) => s.getStringingTotal());

  const mainsProduct = getStringById(catalog, beds.mains.stringId) ?? catalog[0];
  const crossesProduct = getStringById(catalog, beds.crosses.stringId) ?? catalog[0];
  const mainsNorm = normalizeBed(mainsProduct, beds.mains);
  const crossesNorm = normalizeBed(crossesProduct, beds.crosses);

  const mainsShort = mainsProduct.name.split(" ").slice(-2).join(" ");
  const crossesShort = crossesProduct.name.split(" ").slice(-2).join(" ");

  return (
    <>
      <div className="proto-desk-hybrid-headers">
        <div className="proto-desk-hcol-head proto-desk-hcol-head--m">Mains string</div>
        <div className="proto-desk-hcol-head proto-desk-hcol-head--c">Crosses string</div>
        <div className="proto-desk-hcol-head proto-desk-hcol-head--sum">Order summary</div>
      </div>

      <div className="proto-desk-hybrid-body">
        <div className="proto-desk-hcol">
          <StringCatalog
            catalog={catalog}
            selectedId={mainsNorm.stringId}
            accent="mains"
            onSelect={(id) => {
              const p = getStringById(catalog, id);
              if (p) update("mains", normalizeBed(p, mainsNorm));
            }}
          />
          <div className="proto-desk-hcol-config">
            <BedConfigFields
              bed={mainsNorm}
              product={mainsProduct}
              accent="mains"
              tensionTitle="Mains tension"
              tensionRange={tensionRange}
              recommendedTension={tensionRange.recommended}
              recommendedGauge="16"
              onChange={(b) => update("mains", b)}
            />
          </div>
        </div>

        <div className="proto-desk-hcol">
          <StringCatalog
            catalog={catalog}
            selectedId={crossesNorm.stringId}
            accent="crosses"
            onSelect={(id) => {
              const p = getStringById(catalog, id);
              if (p) update("crosses", normalizeBed(p, crossesNorm));
            }}
          />
          <div className="proto-desk-hcol-config">
            <BedConfigFields
              bed={crossesNorm}
              product={crossesProduct}
              accent="crosses"
              tensionTitle="Crosses tension"
              tensionRange={tensionRange}
              recommendedTension={crossesFromMains(tensionRange.recommended, tensionRange)}
              recommendedGauge="16"
              onChange={(b) => update("crosses", b)}
            />
          </div>
        </div>

        <div className="proto-desk-hcol-sum">
          <SelectedCard
            accent="mains"
            eyebrow="Mains"
            name={mainsProduct.name}
            sub={`${mainsNorm.gauge}g · ${mainsNorm.color} · ${mainsNorm.tension} lbs · ${formatStringPrice(mainsProduct.price)}`}
          />
          <SelectedCard
            accent="crosses"
            eyebrow="Crosses"
            name={crossesProduct.name}
            sub={`${crossesNorm.gauge}g · ${crossesNorm.color} · ${crossesNorm.tension} lbs · ${formatStringPrice(crossesProduct.price)}`}
          />
          <div className="proto-desk-divider" />
          <OrderSummary
            basePrice={basePrice}
            stringLines={[
              { label: `Mains — ${mainsShort}`, value: formatStringPrice(mainsProduct.price) },
              {
                label: `Crosses — ${crossesShort}`,
                value: formatStringPrice(crossesProduct.price),
              },
            ]}
            laborPrice={laborPrice}
            total={total}
          />
          <AddToCartButton total={total} onAddToCart={onAddToCart} isAddingToCart={isAddingToCart} />
          <TrustStrip />
        </div>
      </div>
    </>
  );
}

type StringingConfiguratorProps = {
  onClose: () => void;
  onAddToCart: () => void;
  isAddingToCart: boolean;
};

export function StringingConfigurator({
  onClose,
  onAddToCart,
  isAddingToCart,
}: StringingConfiguratorProps) {
  const configurator = useConfiguratorStore((s) => s.configurator);
  const mode = useConfiguratorStore((s) => s.stringingMode);
  const cartError = useConfiguratorStore((s) => s.cartError);

  const catalog = useMemo(
    () => resolveStringCatalog(configurator),
    [configurator],
  );

  if (!configurator) return null;

  if (catalog.length === 0) {
    return (
      <div className="proto-desk-shell flex flex-col h-full items-center justify-center gap-2 p-8 text-center">
        <p className="text-neutral-800 font-semibold text-sm">No strings available right now.</p>
        <p className="text-neutral-500 text-xs">Please contact us to arrange your stringing.</p>
      </div>
    );
  }

  const basePrice = configurator.basePrice;
  const laborPrice = configurator.laborPrice ?? 0;
  const tensionRange = configurator.tensionRange ?? DEFAULT_TENSION_RANGE;

  return (
    <div className="proto-desk-shell flex flex-col flex-1 min-h-0 h-full">
      <div className="proto-desk-header">
        <h2 className="text-[15px] font-bold text-neutral-900 tracking-tight">
          String your racquet
        </h2>
        <div className="flex items-center gap-3">
          <ModeToggle />
          <button
            type="button"
            onClick={onClose}
            className="proto-desk-close"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="proto-desk-rq-strip">
        <div>
          <p className="text-base font-bold text-neutral-900">{configurator.name}</p>
          <p className="text-xs text-neutral-500 mt-0.5">
            {configurator.description ?? "Custom stringing"}
          </p>
        </div>
        <p className="text-base font-bold text-neutral-900">${basePrice.toFixed(0)}</p>
      </div>

      <div className="flex-1 overflow-y-auto proto-scrollbar min-h-0">
        {mode === "standard" ? (
          <StandardDesktop
            catalog={catalog}
            basePrice={basePrice}
            laborPrice={laborPrice}
            tensionRange={tensionRange}
            onAddToCart={onAddToCart}
            isAddingToCart={isAddingToCart}
          />
        ) : (
          <HybridDesktop
            catalog={catalog}
            basePrice={basePrice}
            laborPrice={laborPrice}
            tensionRange={tensionRange}
            onAddToCart={onAddToCart}
            isAddingToCart={isAddingToCart}
          />
        )}
      </div>

      {cartError && (
        <div className="mx-4 mb-4 px-4 py-2 rounded-lg bg-red-500/90 text-white text-sm">
          {cartError}
        </div>
      )}
    </div>
  );
}
