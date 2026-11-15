// Charts drawn with HTML and SVG in token colours. Each chart has a text
// summary (aria-label) and a visually hidden table with the same numbers.
import type { ReactNode } from "react";
import { cx } from "../foundations/hooks";

export type SeriesColor = number | "accent" | "success" | "warning" | "danger" | "info" | "muted";

export function seriesColor(c: SeriesColor): string {
  if (typeof c === "number") return `var(--data-cat-${(c % 8) + 1})`;
  if (c === "muted") return "var(--color-text-muted)";
  return `var(--color-${c})`;
}

function DataTableSr({ caption, head, rows }: { caption: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <table className="dui-sr">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {head.map((h) => (
            <th key={h}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (
              <td key={j}>{c}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export interface BarListItem {
  label: ReactNode;
  /** Plain text label for the summary table. */
  text: string;
  value: number;
  detail?: ReactNode;
  color?: SeriesColor;
  onClick?: () => void;
}

/** Horizontal bars with direct labels: the default chart for "how many of each". */
export function BarList({ items, label, max, format = (n: number) => n.toLocaleString(), unit = "" }: { items: BarListItem[]; label: string; max?: number; format?: (n: number) => string; unit?: string }) {
  const m = max ?? Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="dui-barlist" role="figure" aria-label={label}>
      {items.map((it, i) => {
        const Row = it.onClick ? "button" : "div";
        return (
          <Row key={i} type={it.onClick ? "button" : undefined} className={cx("dui-barlist__row", it.onClick && "is-interactive")} onClick={it.onClick}>
            <span className="dui-barlist__label">{it.label}</span>
            <span className="dui-barlist__track" aria-hidden="true">
              <span className="dui-barlist__bar" style={{ width: `${(it.value / m) * 100}%`, background: seriesColor(it.color ?? "accent") }} />
            </span>
            <span className="dui-barlist__value">
              {format(it.value)}
              {unit}
            </span>
            {it.detail && <span className="dui-barlist__detail">{it.detail}</span>}
          </Row>
        );
      })}
      <DataTableSr caption={label} head={["Item", "Value"]} rows={items.map((i) => [i.text, i.value])} />
    </div>
  );
}

export interface Segment {
  label: string;
  value: number;
  color: SeriesColor;
}

/** One horizontal bar split into parts, with a legend. */
export function StackedBar({ segments, label, height = 8, legend = true, total }: { segments: Segment[]; label: string; height?: number; legend?: boolean; total?: number }) {
  const sum = total ?? segments.reduce((n, s) => n + s.value, 0);
  const summary = `${label}: ${segments.map((s) => `${s.label} ${s.value}`).join(", ")}`;
  return (
    <div className="dui-stacked" role="img" aria-label={summary}>
      <div className="dui-stacked__bar" style={{ height }} aria-hidden="true">
        {segments.map((s, i) =>
          s.value > 0 ? <span key={i} style={{ flexGrow: s.value, background: seriesColor(s.color) }} title={`${s.label}: ${s.value}`} /> : null,
        )}
        {sum === 0 && <span className="is-empty" style={{ flexGrow: 1 }} />}
      </div>
      {legend && (
        <div className="dui-legend" aria-hidden="true">
          {segments.map((s, i) => (
            <span key={i} className="dui-legend__item">
              <span className="dui-legend__swatch" style={{ background: seriesColor(s.color) }} />
              {s.label} <b>{s.value.toLocaleString()}</b>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export interface BarChartDatum {
  label: string;
  values: number[];
}

/** Vertical grouped or stacked bars. */
export function BarChart({ data, series, label, height = 160, stacked = false, max }: { data: BarChartDatum[]; series: { label: string; color: SeriesColor }[]; label: string; height?: number; stacked?: boolean; max?: number }) {
  const m = max ?? Math.max(1, ...data.map((d) => (stacked ? d.values.reduce((a, b) => a + b, 0) : Math.max(...d.values))));
  const w = 100 / Math.max(1, data.length);
  const ticks = [0, 0.5, 1].map((t) => Math.round(m * t));
  return (
    <figure className="dui-barchart" aria-label={label}>
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" width="100%" height={height} role="img" aria-label={label}>
        {ticks.map((t) => (
          <line key={t} x1="0" x2="100" y1={height - (t / m) * (height - 4)} y2={height - (t / m) * (height - 4)} className="dui-chart__grid" vectorEffect="non-scaling-stroke" />
        ))}
        {data.map((d, i) => {
          let acc = 0;
          return d.values.map((v, j) => {
            const h = (v / m) * (height - 4);
            const bw = stacked ? w * 0.6 : (w * 0.7) / d.values.length;
            const x = stacked ? i * w + w * 0.2 : i * w + w * 0.15 + j * bw;
            const y = stacked ? height - acc - h : height - h;
            acc += stacked ? h : 0;
            return <rect key={`${i}-${j}`} x={x} y={y} width={Math.max(0.5, bw - 0.4)} height={h} fill={seriesColor(series[j]?.color ?? j)} rx="0.4" />;
          });
        })}
      </svg>
      <div className="dui-barchart__labels" aria-hidden="true">
        {data.map((d) => (
          <span key={d.label} style={{ width: `${w}%` }} title={d.label}>
            {d.label}
          </span>
        ))}
      </div>
      <div className="dui-legend" aria-hidden="true">
        {series.map((s, i) => (
          <span key={s.label} className="dui-legend__item">
            <span className="dui-legend__swatch" style={{ background: seriesColor(s.color ?? i) }} />
            {s.label}
          </span>
        ))}
      </div>
      <DataTableSr caption={label} head={["", ...series.map((s) => s.label)]} rows={data.map((d) => [d.label, ...d.values])} />
    </figure>
  );
}

/** A line chart over evenly spaced points. */
export function LineChart({ series, labels, label, height = 140 }: { series: { label: string; values: number[]; color: SeriesColor }[]; labels: string[]; label: string; height?: number }) {
  const all = series.flatMap((s) => s.values);
  const max = Math.max(1, ...all);
  const n = Math.max(2, labels.length);
  const pt = (v: number, i: number) => `${(i / (n - 1)) * 100},${height - 4 - (v / max) * (height - 12)}`;
  return (
    <figure className="dui-linechart" aria-label={label}>
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" width="100%" height={height} role="img" aria-label={label}>
        {[0, 0.5, 1].map((t) => (
          <line key={t} x1="0" x2="100" y1={height - 4 - t * (height - 12)} y2={height - 4 - t * (height - 12)} className="dui-chart__grid" vectorEffect="non-scaling-stroke" />
        ))}
        {series.map((s) => (
          <polyline key={s.label} points={s.values.map(pt).join(" ")} fill="none" stroke={seriesColor(s.color)} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        ))}
      </svg>
      <div className="dui-legend" aria-hidden="true">
        {series.map((s) => (
          <span key={s.label} className="dui-legend__item">
            <span className="dui-legend__swatch" style={{ background: seriesColor(s.color) }} />
            {s.label}
          </span>
        ))}
      </div>
      <DataTableSr caption={label} head={["", ...series.map((s) => s.label)]} rows={labels.map((l, i) => [l, ...series.map((s) => s.values[i] ?? "")])} />
    </figure>
  );
}

export function Sparkline({ values, label, color = "accent", width = 72, height = 20 }: { values: number[]; label: string; color?: SeriesColor; width?: number; height?: number }) {
  const max = Math.max(1, ...values);
  const n = Math.max(2, values.length);
  const pts = values.map((v, i) => `${(i / (n - 1)) * width},${height - 2 - (v / max) * (height - 4)}`).join(" ");
  return (
    <svg className="dui-sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label}: ${values.join(", ")}`}>
      <polyline points={pts} fill="none" stroke={seriesColor(color)} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

export interface PairedRow {
  label: string;
  a: number | null;
  b: number | null;
}

/**
 * Two measurements per row on one axis, joined by a line: before and after,
 * or without and with. The direction of change reads at a glance; both values
 * are printed, and a hidden table carries the numbers.
 */
export function PairedDots({ rows, a, b, label, max, format = (n: number) => n.toLocaleString(), better = "lower" }: { rows: PairedRow[]; a: string; b: string; label: string; max?: number; format?: (n: number) => string; better?: "lower" | "higher" }) {
  const m = max ?? Math.max(1, ...rows.flatMap((r) => [r.a ?? 0, r.b ?? 0]));
  const x = (v: number) => `${(v / m) * 100}%`;
  return (
    <figure className="dui-paired" aria-label={label}>
      <div className="dui-paired__legend" aria-hidden="true">
        <span>
          <span className="dui-paired__mark is-a" /> {a}
        </span>
        <span>
          <span className="dui-paired__mark is-b" /> {b}
        </span>
        <span className="dui-paired__better">{better === "lower" ? "lower is better" : "higher is better"}</span>
      </div>
      <ul className="dui-paired__rows" aria-hidden="true">
        {rows.map((r) => {
          const lo = Math.min(r.a ?? 0, r.b ?? 0);
          const hi = Math.max(r.a ?? 0, r.b ?? 0);
          const improved = r.a !== null && r.b !== null && (better === "lower" ? r.b < r.a : r.b > r.a);
          const worse = r.a !== null && r.b !== null && (better === "lower" ? r.b > r.a : r.b < r.a);
          return (
            <li key={r.label} className={cx("dui-paired__row", improved && "is-better", worse && "is-worse")}>
              <span className="dui-paired__label" title={r.label}>
                {r.label}
              </span>
              <span className="dui-paired__track">
                {r.a !== null && r.b !== null && <span className="dui-paired__link" style={{ left: x(lo), width: `calc(${x(hi)} - ${x(lo)})` }} />}
                {r.a !== null && <span className="dui-paired__mark is-a" style={{ left: x(r.a) }} />}
                {r.b !== null && <span className="dui-paired__mark is-b" style={{ left: x(r.b) }} />}
              </span>
              <span className="dui-paired__values">
                {r.a === null ? "–" : format(r.a)} → {r.b === null ? "–" : format(r.b)}
              </span>
            </li>
          );
        })}
      </ul>
      <DataTableSr caption={label} head={["", a, b]} rows={rows.map((r) => [r.label, r.a ?? "", r.b ?? ""])} />
    </figure>
  );
}
