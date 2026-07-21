import { useMemo, useState, type ReactNode } from "react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { useLoaderData } from "@remix-run/react";
import {
  BlockStack,
  Card,
  DataTable,
  InlineGrid,
  InlineStack,
  Layout,
  Page,
  Text,
} from "@shopify/polaris";
import { ensureShop, getAnalyticsSummary } from "~/lib/configurator.server";
import { parseJson } from "~/lib/configurator.types";
import { authenticate } from "~/shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const analytics = await getAnalyticsSummary(shop.id, 30, { includeEvents: true });
  return json({ analytics });
};

/* ---------------------------------------------------------------------------------------------
 * Visualization palette — validated with the dataviz palette validator against the white Polaris
 * card surface: categorical slots 1–3 (blue/orange/aqua) pass all-pairs CVD + normal-vision
 * floors; aqua sits below 3:1 contrast on white, so every chart using it also ships direct
 * labels AND a table view (the relief rule). The funnel uses the ordinal blue ramp
 * (steps 250/450/650 — the 250 end stays ≥2:1 on white).
 * ------------------------------------------------------------------------------------------- */
const VIZ = {
  opens: "#2a78d6", // categorical slot 1 (blue)
  carts: "#eb6834", // categorical slot 2 (orange)
  purchases: "#1baf7a", // categorical slot 3 (aqua)
  funnelRamp: ["#86b6ef", "#2a78d6", "#104281"], // ordinal blue ramp, light → dark
  grid: "#e1e0d9",
  axis: "#c3c2b7",
  muted: "#898781",
  ink: "#0b0b0b",
  secondary: "#52514e",
  good: "#006300", // success text (light surface)
  bad: "#d03b3b",
} as const;

type TrendPoint = { day: string; opens: number; addToCarts: number; purchases: number };

function pct(numerator: number, denominator: number): string {
  if (denominator <= 0) return "—";
  return `${Math.round((numerator / denominator) * 100)}%`;
}

function money(value: number): string {
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

/* ------------------------------------ building blocks ------------------------------------ */

/** Honest "nothing here yet" placeholder — no invented numbers, ever. Shown only when a section's
 *  underlying data is genuinely empty; sections with real data (even all-zero real data, which is
 *  itself meaningful) render their real numbers instead. */
function EmptyState({ message, height = 120 }: { message: string; height?: number }) {
  return (
    <div
      style={{
        minHeight: height,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        border: `1px dashed ${VIZ.grid}`,
        borderRadius: 8,
        padding: 16,
      }}
    >
      <Text as="p" variant="bodySm" tone="subdued">
        {message}
      </Text>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <BlockStack gap="300">
        <Text as="h2" variant="headingMd">
          {title}
        </Text>
        {children}
      </BlockStack>
    </Card>
  );
}

function StatTile({
  label,
  value,
  sub,
  subTone,
  hero,
}: {
  label: string;
  value: string;
  sub?: string;
  subTone?: "good" | "bad";
  hero?: boolean;
}) {
  return (
    <Card>
      <BlockStack gap="100">
        <Text as="p" variant="bodySm" tone="subdued">
          {label}
        </Text>
        <span
          style={{
            fontSize: hero ? 40 : 28,
            lineHeight: 1.1,
            fontWeight: 650,
            color: VIZ.ink,
            letterSpacing: "-0.02em",
          }}
        >
          {value}
        </span>
        {sub && (
          <span
            style={{
              fontSize: 12,
              color: subTone === "good" ? VIZ.good : subTone === "bad" ? VIZ.bad : VIZ.secondary,
            }}
          >
            {sub}
          </span>
        )}
      </BlockStack>
    </Card>
  );
}

/** Horizontal 3-stage funnel — ordinal blue ramp, direct-labeled, rounded data-ends. */
function FunnelViz({
  stages,
}: {
  stages: { label: string; value: number; rateFromPrev: string | null }[];
}) {
  const max = Math.max(1, ...stages.map((s) => s.value));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {stages.map((stage, i) => (
        <div key={stage.label}>
          {stage.rateFromPrev && (
            <div style={{ fontSize: 11, color: VIZ.muted, margin: "0 0 4px 148px" }}>
              ↓ {stage.rateFromPrev} continue
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 138, fontSize: 12, color: VIZ.secondary, textAlign: "right" }}>
              {stage.label}
            </span>
            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
              <div
                style={{
                  width: `${Math.max(2, (stage.value / max) * 100)}%`,
                  height: 14,
                  background: VIZ.funnelRamp[i] ?? VIZ.funnelRamp[VIZ.funnelRamp.length - 1],
                  borderRadius: "0 4px 4px 0",
                  minWidth: 6,
                }}
              />
              <span style={{ fontSize: 13, fontWeight: 650, color: VIZ.ink, whiteSpace: "nowrap" }}>
                {stage.value.toLocaleString()}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Two-category comparison bars (standard vs hybrid) — direct-labeled. */
function ModeBars({ modes }: { modes: Record<string, number> }) {
  const entries = Object.entries(modes).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, v]) => v));
  const color = (mode: string) =>
    mode === "hybrid" ? VIZ.carts : mode === "standard" ? VIZ.opens : VIZ.muted;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {entries.map(([mode, count]) => (
        <div key={mode} style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              width: 80,
              fontSize: 12,
              color: VIZ.secondary,
              textAlign: "right",
              textTransform: "capitalize",
            }}
          >
            {mode}
          </span>
          <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
            <div
              style={{
                width: `${Math.max(2, (count / max) * 100)}%`,
                height: 14,
                background: color(mode),
                borderRadius: "0 4px 4px 0",
                minWidth: 6,
              }}
            />
            <span style={{ fontSize: 13, fontWeight: 650, color: VIZ.ink }}>{count}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/* --------------------------------------- trend chart --------------------------------------- */

const SERIES = [
  { key: "opens", label: "Opens", color: VIZ.opens },
  { key: "addToCarts", label: "Add to cart", color: VIZ.carts },
  { key: "purchases", label: "Purchases", color: VIZ.purchases },
] as const;

const CHART = { w: 720, h: 240, top: 14, right: 108, bottom: 26, left: 40 };

/** Smallest multiple of 4 with ~5% headroom above the data max — quarter gridlines land on
 *  integers and the lines use the full plot height (a power-of-ten max wastes half the chart). */
function niceMax(raw: number): number {
  return Math.max(4, Math.ceil((raw * 1.05) / 4) * 4);
}

function shortDay(day: string): string {
  // "2026-07-21" → "Jul 21"; sample labels ("Day 12") pass through.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return day;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[Number(m[2]) - 1]} ${Number(m[3])}`;
}

/** Multi-series line chart: hairline grid, 2px lines, legend + direct end-labels, hover
 *  crosshair with tooltip, and a <details> table view (the aqua relief + a11y table). */
function TrendChart({ data }: { data: TrendPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const { w, h, top, right, bottom, left } = CHART;
  const plotW = w - left - right;
  const plotH = h - top - bottom;

  const yMax = useMemo(
    () => niceMax(Math.max(1, ...data.flatMap((d) => [d.opens, d.addToCarts, d.purchases]))),
    [data],
  );
  const x = (i: number) => left + (data.length <= 1 ? 0 : (i / (data.length - 1)) * plotW);
  const y = (v: number) => top + plotH - (v / yMax) * plotH;

  const gridLines = [0.25, 0.5, 0.75, 1].map((f) => ({ v: yMax * f, py: y(yMax * f) }));
  const last = data.length - 1;

  // Direct end-labels must not overlap when lines converge: sort by natural position and push
  // each at least 13px below the previous. Dots stay at the true data point.
  const endLabelY: Record<string, number> = {};
  {
    const entries = SERIES.map((s) => ({ key: s.key as string, py: y(data[last][s.key]) })).sort(
      (a, b) => a.py - b.py,
    );
    for (let i = 0; i < entries.length; i++) {
      if (i > 0 && entries[i].py - entries[i - 1].py < 13) {
        entries[i].py = entries[i - 1].py + 13;
      }
      endLabelY[entries[i].key] = entries[i].py;
    }
  }

  return (
    <div style={{ position: "relative" }}>
      {/* Legend — always present for multi-series. */}
      <div style={{ display: "flex", gap: 16, marginBottom: 8, flexWrap: "wrap" }}>
        {SERIES.map((s) => (
          <span key={s.key} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color }} />
            <span style={{ fontSize: 12, color: VIZ.secondary }}>{s.label}</span>
          </span>
        ))}
      </div>

      <svg
        viewBox={`0 0 ${w} ${h}`}
        style={{ width: "100%", height: "auto", display: "block" }}
        role="img"
        aria-label="Daily opens, add-to-carts, and purchases"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * w;
          const idx = Math.round(((px - left) / plotW) * (data.length - 1));
          setHover(Math.max(0, Math.min(data.length - 1, idx)));
        }}
      >
        {gridLines.map((g) => (
          <g key={g.v}>
            <line x1={left} x2={left + plotW} y1={g.py} y2={g.py} stroke={VIZ.grid} strokeWidth={1} />
            <text x={left - 6} y={g.py + 3.5} textAnchor="end" fontSize={10} fill={VIZ.muted}>
              {g.v}
            </text>
          </g>
        ))}
        <line x1={left} x2={left + plotW} y1={top + plotH} y2={top + plotH} stroke={VIZ.axis} strokeWidth={1} />

        {[0, Math.floor(last / 2), last]
          .filter((v, i, arr) => arr.indexOf(v) === i)
          .map((i) => (
            <text key={i} x={x(i)} y={h - 8} textAnchor="middle" fontSize={10} fill={VIZ.muted}>
              {shortDay(data[i].day)}
            </text>
          ))}

        {hover != null && (
          <line x1={x(hover)} x2={x(hover)} y1={top} y2={top + plotH} stroke={VIZ.axis} strokeWidth={1} />
        )}

        {SERIES.map((s) => {
          const points = data.map((d, i) => `${x(i)},${y(d[s.key])}`).join(" ");
          return (
            <g key={s.key}>
              <polyline
                points={points}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {/* End marker + direct label (text stays in ink, identity via the adjacent line/dot). */}
              <circle cx={x(last)} cy={y(data[last][s.key])} r={3.5} fill={s.color} />
              <text
                x={x(last) + 8}
                y={endLabelY[s.key] + 3.5}
                fontSize={11}
                fill={VIZ.secondary}
              >
                {s.label} · {data[last][s.key]}
              </text>
              {hover != null && (
                <circle
                  cx={x(hover)}
                  cy={y(data[hover][s.key])}
                  r={4}
                  fill={s.color}
                  stroke="#ffffff"
                  strokeWidth={2}
                />
              )}
            </g>
          );
        })}
      </svg>

      {hover != null && (
        <div
          style={{
            position: "absolute",
            left: `${Math.min(78, Math.max(4, (x(hover) / w) * 100))}%`,
            top: 34,
            background: "#ffffff",
            border: "1px solid rgba(11,11,11,0.10)",
            borderRadius: 8,
            boxShadow: "0 2px 10px rgba(0,0,0,0.08)",
            padding: "8px 10px",
            pointerEvents: "none",
            fontSize: 12,
            color: VIZ.secondary,
            whiteSpace: "nowrap",
          }}
        >
          <div style={{ fontWeight: 650, color: VIZ.ink, marginBottom: 4 }}>
            {shortDay(data[hover].day)}
          </div>
          {SERIES.map((s) => (
            <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color }} />
              {s.label}: <strong style={{ color: VIZ.ink }}>{data[hover][s.key]}</strong>
            </div>
          ))}
        </div>
      )}

      <details style={{ marginTop: 8 }}>
        <summary style={{ fontSize: 12, color: VIZ.muted, cursor: "pointer" }}>
          View as table
        </summary>
        <DataTable
          columnContentTypes={["text", "numeric", "numeric", "numeric"]}
          headings={["Day", "Opens", "Add to cart", "Purchases"]}
          rows={[...data]
            .reverse()
            .map((t) => [shortDay(t.day), String(t.opens), String(t.addToCarts), String(t.purchases)])}
        />
      </details>
    </div>
  );
}

/* ------------------------------------------ page ------------------------------------------ */

export default function AnalyticsPage() {
  const { analytics } = useLoaderData<typeof loader>();
  const { funnel, revenue, byMode, byDevice, byRacquet, trend, counts } = analytics;

  // Each of these is genuinely empty (no rows at all for that dimension) vs. real data that
  // happens to include zeros — the funnel/KPI row always shows real numbers, since "0 opens" or
  // "0% conversion" is itself a true, meaningful result, not an absence of data.
  const revenueEmpty = revenue.purchased === 0 && revenue.added === 0;
  const trendEmpty = trend.length === 0;
  const modeEmpty = Object.keys(byMode).length === 0;
  const deviceEmpty = byDevice.length === 0;
  const racquetEmpty = byRacquet.length === 0;

  const liftGood = revenue.aovLiftPct >= 0;

  const eventRows = analytics.events.slice(0, 50).map((event) => {
    const meta = parseJson<Record<string, unknown>>(event.metadata, {});
    return [
      new Date(event.createdAt).toLocaleString(),
      event.eventType,
      event.productId ?? "—",
      JSON.stringify(meta).slice(0, 80),
    ];
  });

  return (
    <Page
      title="Configurator analytics"
      subtitle="Last 30 days"
      backAction={{ content: "Dashboard", url: "/app" }}
    >
      <Layout>
        {/* KPI hero row — always real: 0 is a true result, not a placeholder. */}
        <Layout.Section>
          <InlineGrid columns={{ xs: 2, sm: 4 }} gap="300">
            <StatTile
              hero
              label="Overall conversion"
              value={pct(funnel.purchaseSessions, funnel.openSessions)}
              sub="opens → purchase"
            />
            <StatTile
              label="Configurator opens"
              value={funnel.openSessions.toLocaleString()}
              sub="unique sessions"
            />
            <StatTile
              label="Cart rate"
              value={pct(funnel.cartSessions, funnel.openSessions)}
              sub="opens → add to cart"
            />
            <StatTile
              label="Checkout rate"
              value={pct(funnel.purchaseSessions, funnel.cartSessions)}
              sub="add to cart → purchase"
            />
          </InlineGrid>
        </Layout.Section>

        {/* Funnel + revenue */}
        <Layout.Section>
          <InlineGrid columns={{ xs: 1, md: 2 }} gap="300">
            <Section title="Session funnel">
              <FunnelViz
                stages={[
                  { label: "Opened configurator", value: funnel.openSessions, rateFromPrev: null },
                  {
                    label: "Added to cart",
                    value: funnel.cartSessions,
                    rateFromPrev: pct(funnel.cartSessions, funnel.openSessions),
                  },
                  {
                    label: "Purchased",
                    value: funnel.purchaseSessions,
                    rateFromPrev: pct(funnel.purchaseSessions, funnel.cartSessions),
                  },
                ]}
              />
            </Section>
            <Section title="Revenue">
              {revenueEmpty ? (
                <EmptyState message="No add-to-carts or purchases yet — revenue metrics appear once shoppers configure and buy." />
              ) : (
                <InlineGrid columns={2} gap="300">
                  <StatTile label="Purchased" value={money(revenue.purchased)} />
                  <StatTile
                    label="Avg configurator order"
                    value={money(revenue.configAOV)}
                    sub={
                      revenue.configAOV > 0 && revenue.storeAOV > 0
                        ? `${liftGood ? "↑" : "↓"} ${Math.abs(Math.round(revenue.aovLiftPct))}% vs store AOV ${money(revenue.storeAOV)}`
                        : undefined
                    }
                    subTone={liftGood ? "good" : "bad"}
                  />
                  <StatTile
                    label="Incremental added"
                    value={money(revenue.incrementalTotal)}
                    sub="strings + labor + add-ons"
                  />
                  <StatTile
                    label="Revenue per open"
                    value={money(revenue.revenuePerOpen)}
                    sub={`incremental ${money(revenue.incrementalPerOrder)}/order`}
                  />
                </InlineGrid>
              )}
            </Section>
          </InlineGrid>
        </Layout.Section>

        {/* Trend */}
        <Layout.Section>
          <Section title="Daily activity">
            {trendEmpty ? (
              <EmptyState message="No activity yet — this chart fills in as shoppers open the configurator." height={200} />
            ) : (
              <TrendChart data={trend} />
            )}
          </Section>
        </Layout.Section>

        {/* Mode + device */}
        <Layout.Section>
          <InlineGrid columns={{ xs: 1, md: 2 }} gap="300">
            <Section title="Add-to-cart by mode">
              {modeEmpty ? (
                <EmptyState message="No add-to-carts yet." />
              ) : (
                <ModeBars modes={byMode} />
              )}
            </Section>
            <Section title="By device">
              {deviceEmpty ? (
                <EmptyState message="No sessions yet." />
              ) : (
                <DataTable
                  columnContentTypes={["text", "numeric", "numeric", "numeric", "numeric"]}
                  headings={["Device", "Opens", "Cart", "Buy", "Cart rate"]}
                  rows={byDevice.map((d) => [
                    d.device,
                    String(d.opens),
                    String(d.addToCarts),
                    String(d.purchases),
                    pct(d.addToCarts, d.opens),
                  ])}
                />
              )}
            </Section>
          </InlineGrid>
        </Layout.Section>

        {/* Top racquets */}
        <Layout.Section>
          <Section title="Top racquets">
            {racquetEmpty ? (
              <EmptyState message="No racquet-level activity yet." />
            ) : (
              <DataTable
                columnContentTypes={["text", "numeric", "numeric", "numeric", "numeric", "numeric"]}
                headings={["Product", "Opens", "Cart", "Buy", "Cart rate", "Conv."]}
                rows={byRacquet.map((r) => [
                  r.productId,
                  String(r.opens),
                  String(r.addToCarts),
                  String(r.purchases),
                  pct(r.addToCarts, r.opens),
                  pct(r.purchases, r.opens),
                ])}
              />
            )}
          </Section>
        </Layout.Section>

        {/* Debug: raw event stream + totals, tucked away */}
        <Layout.Section>
          <Card>
            <details>
              <summary style={{ fontSize: 13, color: VIZ.muted, cursor: "pointer" }}>
                Raw events &amp; totals (debug)
              </summary>
              <BlockStack gap="300">
                <div style={{ marginTop: 12 }}>
                  {Object.entries(counts).map(([type, count]) => (
                    <Text as="p" key={type}>
                      {type}: {count}
                    </Text>
                  ))}
                </div>
                <DataTable
                  columnContentTypes={["text", "text", "text", "text"]}
                  headings={["Time", "Event", "Product", "Metadata"]}
                  rows={eventRows}
                />
              </BlockStack>
            </details>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
