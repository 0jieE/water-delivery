import { useEffect, useRef, useState, type ReactNode } from "react";

/*
 * Small, dependency-free charts (SVG / HTML) built to the data-viz rules:
 *  - one hue for a single series, the validated categorical order for several (blue, orange, aqua),
 *  - thin marks (<= 24px), 4px rounded data end, square at the baseline, 2px gaps,
 *  - hairline solid recessive grid, text in neutral ink (never the series colour),
 *  - hover / keyboard tooltips that enhance but never gate (every value is also in the table view),
 *  - a legend whenever there are two or more series.
 * Series colours were checked with the palette validator on the white card surface.
 */

export const SERIES = ["#2a78d6", "#eb6834", "#1baf7a"] as const;
const HOVER = "#3987e5"; // slightly lighter step of series 1, shown while a bar is hovered
const GRID = "#e2e8f0";
const BASELINE = "#cbd5e1";
const MUTED = "#64748b"; // axis / label text (AA on white)

// ---- helpers ----------------------------------------------------------------------------------

export function compact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${+(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n * 100) / 100);
}

/** ~4 round tick values from 0 to a "nice" maximum. */
export function niceTicks(max: number, target = 4): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.999; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    setWidth(Math.floor(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

export interface TipRow {
  label: string;
  value: string;
  /** Series colour, shown as a short line key beside the row. */
  color?: string;
}
export interface Tip {
  title: string;
  rows: TipRow[];
}

/** Floating readout: the value leads, the label follows (names are rendered as text, never HTML). */
function Tooltip({ tip, x, y, width }: { tip: Tip; x: number; y: number; width: number }) {
  const half = 90; // keep the (max ~180px) tooltip inside the chart
  const left = Math.min(Math.max(x, half), Math.max(half, width - half));
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full rounded-lg bg-slate-900 px-3 py-2 text-xs text-white shadow-lift"
      style={{ left, top: Math.max(y - 8, 4) }}
    >
      <div className="mb-1 text-[11px] text-slate-300">{tip.title}</div>
      {tip.rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2 whitespace-nowrap">
          {r.color && <span className="h-0.5 w-3 flex-none rounded-full" style={{ background: r.color }} aria-hidden />}
          <span className="font-bold">{r.value}</span>
          <span className="text-slate-300">{r.label}</span>
        </div>
      ))}
    </div>
  );
}

// ---- column chart (one series over a sequence, e.g. sales per day) ----------------------------

export interface ColumnDatum {
  key: string;
  /** Axis label for this column. */
  label: string;
  value: number;
  tip: Tip;
}

export function ColumnChart({
  data,
  ariaLabel,
  tickFormat = compact,
  valueFormat = compact,
  height = 232,
}: {
  data: ColumnDatum[];
  ariaLabel: string;
  tickFormat?: (n: number) => string;
  valueFormat?: (n: number) => string;
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);

  const M = { top: 22, right: 8, bottom: 30, left: 46 };
  const innerW = Math.max(0, width - M.left - M.right);
  const innerH = height - M.top - M.bottom;
  const max = Math.max(0, ...data.map((d) => d.value));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] || 1;
  const band = data.length ? innerW / data.length : 0;
  const barW = Math.max(2, Math.min(24, band - 2)); // <= 24px thick, always a 2px gap
  const y = (v: number) => M.top + innerH - (v / top) * innerH;
  const stride = Math.max(1, Math.ceil(58 / Math.max(band, 1)));
  const maxIndex = max > 0 ? data.findIndex((d) => d.value === max) : -1;

  function onKey(e: React.KeyboardEvent) {
    if (!data.length) return;
    const last = data.length - 1;
    const cur = active ?? last;
    const next = { ArrowLeft: cur - 1, ArrowRight: cur + 1, Home: 0, End: last }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    setActive(Math.min(last, Math.max(0, next)));
  }

  const a = active !== null ? data[active] : null;
  const ax = active !== null ? M.left + band * active + band / 2 : 0;
  const ay = a ? y(a.value) : 0;

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="group"
          aria-label={`${ariaLabel}. Use the left and right arrow keys to read each value.`}
          tabIndex={0}
          onKeyDown={onKey}
          onFocus={() => setActive((i) => i ?? data.length - 1)}
          onBlur={() => setActive(null)}
          className="block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-water-500"
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={M.left + innerW} y1={y(t)} y2={y(t)} stroke={t === 0 ? BASELINE : GRID} strokeWidth={1} />
              <text x={M.left - 8} y={y(t)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill={MUTED} className="tabular">
                {t === 0 ? "0" : tickFormat(t)}
              </text>
            </g>
          ))}

          {data.map((d, i) => {
            const h = (d.value / top) * innerH;
            const x = M.left + band * i + (band - barW) / 2;
            const r = Math.min(4, h / 2, barW / 2);
            const yy = y(d.value);
            return (
              <g key={d.key}>
                {h > 0 && (
                  <path
                    d={`M${x},${yy + h} L${x},${yy + r} Q${x},${yy} ${x + r},${yy} L${x + barW - r},${yy} Q${x + barW},${yy} ${x + barW},${yy + r} L${x + barW},${yy + h} Z`}
                    fill={active === i ? HOVER : SERIES[0]}
                  />
                )}
                {i % stride === 0 && (
                  <text x={M.left + band * i + band / 2} y={height - 10} textAnchor="middle" fontSize={11} fill={MUTED}>
                    {d.label}
                  </text>
                )}
                {/* The hit target is the whole column slot, far larger than the mark. */}
                <rect
                  x={M.left + band * i}
                  y={M.top}
                  width={band}
                  height={innerH + M.bottom}
                  fill="transparent"
                  onPointerEnter={() => setActive(i)}
                  onPointerMove={() => setActive(i)}
                  onPointerLeave={() => setActive(null)}
                />
              </g>
            );
          })}

          {/* One selective direct label: the peak. */}
          {maxIndex >= 0 && (
            <text
              x={Math.min(Math.max(M.left + band * maxIndex + band / 2, M.left + 14), M.left + innerW - 14)}
              y={y(max) - 7}
              textAnchor="middle"
              fontSize={11}
              fontWeight={700}
              fill="#0f172a"
              className="tabular"
            >
              {valueFormat(max)}
            </text>
          )}
        </svg>
      )}
      {a && <Tooltip tip={a.tip} x={ax} y={ay} width={width} />}
    </div>
  );
}

// ---- horizontal bars (compare magnitudes across named things) --------------------------------

export interface BarDatum {
  key: string;
  label: string;
  value: number;
  /** Text printed at the bar tip. */
  display: string;
  tip: Tip;
}

export function BarList({ data, ariaLabel }: { data: BarDatum[]; ariaLabel: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<{ i: number; y: number; x: number } | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));

  return (
    <div ref={ref} className="relative" role="list" aria-label={ariaLabel}>
      <div className="space-y-2.5">
        {data.map((d, i) => (
          <div
            key={d.key}
            role="listitem"
            tabIndex={0}
            className="grid grid-cols-[minmax(0,8.5rem)_1fr] items-center gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-water-500 sm:grid-cols-[minmax(0,11rem)_1fr]"
            onPointerMove={(e) => {
              const box = ref.current?.getBoundingClientRect();
              if (box) setActive({ i, x: e.clientX - box.left, y: e.currentTarget.getBoundingClientRect().top - box.top });
            }}
            onPointerLeave={() => setActive(null)}
            onFocus={(e) => {
              const box = ref.current?.getBoundingClientRect();
              if (box) setActive({ i, x: width / 2, y: e.currentTarget.getBoundingClientRect().top - box.top });
            }}
            onBlur={() => setActive(null)}
          >
            <span className="truncate text-[13px] text-slate-600" title={d.label}>{d.label}</span>
            <div className="relative h-5">
              <div
                className="absolute left-0 top-1/2 h-3.5 -translate-y-1/2 rounded-r-[4px] transition-[background-color]"
                style={{ width: `${(d.value / max) * 82}%`, minWidth: d.value > 0 ? 3 : 0, background: active?.i === i ? HOVER : SERIES[0] }}
              />
              <span
                className="tabular absolute top-1/2 -translate-y-1/2 pl-2 text-xs font-semibold text-slate-900"
                style={{ left: `${(d.value / max) * 82}%` }}
              >
                {d.display}
              </span>
            </div>
          </div>
        ))}
      </div>
      {active && data[active.i] && <Tooltip tip={data[active.i].tip} x={active.x} y={active.y} width={width} />}
    </div>
  );
}

// ---- stacked horizontal bars (parts of a total, per named thing) -----------------------------

export interface StackSeries {
  key: string;
  label: string;
}
export interface StackDatum {
  key: string;
  label: string;
  values: Record<string, number>;
  total: string;
  tip: Tip;
}

export function StackedBarList({
  series,
  data,
  ariaLabel,
}: {
  series: StackSeries[];
  data: StackDatum[];
  ariaLabel: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<{ i: number; x: number; y: number } | null>(null);
  const sum = (d: StackDatum) => series.reduce((n, s) => n + (d.values[s.key] ?? 0), 0);
  const max = Math.max(1, ...data.map(sum));

  return (
    <div ref={ref} className="relative">
      {/* Two or more series: the legend is always present. */}
      <ul className="mb-4 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-slate-600" aria-label="Legend">
        {series.map((s, i) => (
          <li key={s.key} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: SERIES[i] }} aria-hidden /> {s.label}
          </li>
        ))}
      </ul>
      <div className="space-y-2.5" role="list" aria-label={ariaLabel}>
        {data.map((d, i) => {
          const total = sum(d);
          return (
            <div
              key={d.key}
              role="listitem"
              tabIndex={0}
              className="grid grid-cols-[minmax(0,8.5rem)_1fr] items-center gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-water-500 sm:grid-cols-[minmax(0,11rem)_1fr]"
              onPointerMove={(e) => {
                const box = ref.current?.getBoundingClientRect();
                if (box) setActive({ i, x: e.clientX - box.left, y: e.currentTarget.getBoundingClientRect().top - box.top });
              }}
              onPointerLeave={() => setActive(null)}
              onFocus={(e) => {
                const box = ref.current?.getBoundingClientRect();
                if (box) setActive({ i, x: width / 2, y: e.currentTarget.getBoundingClientRect().top - box.top });
              }}
              onBlur={() => setActive(null)}
            >
              <span className="truncate text-[13px] text-slate-600" title={d.label}>{d.label}</span>
              <div className="relative h-5">
                {/* 2px surface gap between segments; the round end is on the last segment only. */}
                <div className="absolute left-0 top-1/2 flex h-3.5 -translate-y-1/2 gap-0.5" style={{ width: `${(total / max) * 82}%` }}>
                  {series.map((s, si) => {
                    const v = d.values[s.key] ?? 0;
                    if (v <= 0) return null;
                    return (
                      <div
                        key={s.key}
                        className="h-full min-w-[3px] first:rounded-l-none last:rounded-r-[4px]"
                        style={{ flexGrow: v, flexBasis: 0, background: SERIES[si] }}
                      />
                    );
                  })}
                </div>
                <span className="tabular absolute top-1/2 -translate-y-1/2 pl-2 text-xs font-semibold text-slate-900" style={{ left: `${(total / max) * 82}%` }}>
                  {d.total}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      {active && data[active.i] && <Tooltip tip={data[active.i].tip} x={active.x} y={active.y} width={width} />}
    </div>
  );
}

// ---- stat tile with a sparkline (one headline number + its trend) ----------------------------

export interface SparkPoint {
  label: string;
  value: number;
  /** Previous period is drawn in the de-emphasis grey; the current one in the accent. */
  current: boolean;
}

export function StatTile({
  label,
  value,
  delta,
  deltaGood,
  deltaNote,
  points,
  format,
  icon,
}: {
  label: string;
  value: string;
  /** Signed text such as "+12%"; omit when there is nothing to compare. */
  delta?: string;
  /** Direction × "is up good": decides the delta colour. */
  deltaGood?: boolean;
  deltaNote?: string;
  points: SparkPoint[];
  format: (n: number) => string;
  icon?: ReactNode;
}) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...points.map((p) => p.value));
  const W = 168;
  const H = 44;
  const gap = 2;
  const bw = Math.max(2, (W - gap * (points.length - 1)) / Math.max(points.length, 1));
  return (
    <div className="card relative p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[13px] font-medium text-slate-500">{icon}{label}</p>
          <p className="tabular mt-2 text-3xl font-bold tracking-tight text-slate-900">{value}</p>
          {delta && (
            <p className="mt-1 text-xs">
              <span className={`font-semibold ${deltaGood ? "text-emerald-700" : "text-red-700"}`}>
                {deltaGood ? "▲" : "▼"} {delta}
              </span>{" "}
              <span className="text-slate-500">{deltaNote}</span>
            </p>
          )}
        </div>
        <div className="relative flex-none">
          <svg width={W} height={H} role="img" aria-label={`${label}, daily values`} className="block overflow-visible">
            <line x1={0} x2={W} y1={H - 0.5} y2={H - 0.5} stroke={BASELINE} />
            {points.map((p, i) => {
              const h = Math.max(p.value > 0 ? 2 : 0, (p.value / max) * (H - 4));
              const x = i * (bw + gap);
              const r = Math.min(3, bw / 2, h / 2);
              return (
                <g key={i}>
                  {h > 0 && (
                    <path
                      d={`M${x},${H - 1} L${x},${H - 1 - h + r} Q${x},${H - 1 - h} ${x + r},${H - 1 - h} L${x + bw - r},${H - 1 - h} Q${x + bw},${H - 1 - h} ${x + bw},${H - 1 - h + r} L${x + bw},${H - 1} Z`}
                      fill={p.current ? (active === i ? HOVER : SERIES[0]) : active === i ? "#94a3b8" : "#cbd5e1"}
                    />
                  )}
                  <rect x={x - gap / 2} y={0} width={bw + gap} height={H} fill="transparent" onPointerEnter={() => setActive(i)} onPointerLeave={() => setActive(null)} />
                </g>
              );
            })}
          </svg>
          {active !== null && points[active] && (
            <Tooltip
              tip={{ title: points[active].label, rows: [{ label: points[active].current ? "this period" : "previous period", value: format(points[active].value), color: points[active].current ? SERIES[0] : "#94a3b8" }] }}
              x={active * (bw + gap) + bw / 2}
              y={0}
              width={W}
            />
          )}
        </div>
      </div>
    </div>
  );
}
