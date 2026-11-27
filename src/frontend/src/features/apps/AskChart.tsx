import { useLayoutEffect, useState } from "react";
import { capitalise, formatNumber } from "@/lib/format";
import { NO_VALUE, Stat } from "@/components/ui/stat";
import { Cell, Table, TableRow, type Column } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { AskChart } from "@/store/types";
import { niceStep } from "./appModel";

/**
 * An answer's chart, drawn from the chart spec the control plane returns: a single number, bars,
 * a line or a table. Every chart carries a text alternative that reads the same figures.
 */

const MAX_BARS = 24;
const MAX_POINTS = 120;

/** A series' colour: the accent for the first (and only, usually); the two retired hues only for a second and third series. */
const FILLS = ["bg-primary", "bg-violet", "bg-teal"];
const STROKES = ["stroke-primary", "stroke-violet", "stroke-teal"];

function label(x: unknown): string {
  if (x === null || x === undefined) return "—";
  if (typeof x === "number") return formatNumber(x);
  if (typeof x === "string") {
    // A day or a moment: say it as a date, not as a timestamp.
    if (/^\d{4}-\d{2}-\d{2}(T|$)/.test(x)) {
      const d = new Date(x);
      if (!Number.isNaN(d.getTime())) return x.length > 10 && !/T00:00:00/.test(x) ? d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    }
    return x;
  }
  return String(x);
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return formatNumber(v);
  if (typeof v === "string") return label(v);
  return JSON.stringify(v);
}

export function AskChartView({ chart, columns, rows, className }: { chart: AskChart | null; columns: string[]; rows: Record<string, unknown>[]; className?: string }) {
  if (!chart || chart.kind === "table" || chart.series.length === 0) return <AnswerTable columns={columns} rows={rows} className={className} />;
  if (chart.kind === "number") {
    const y = chart.series[0]?.points[0]?.y ?? null;
    // One figure: the figure tile, its series named over it.
    return (
      <div role="group" aria-label={`${chart.series[0]?.name ?? "Value"}: ${y === null ? "no value" : formatNumber(y)}`} className={className}>
        <Stat plain size="lg" label={capitalise(label(chart.series[0]?.name ?? "Value"))} value={y === null ? NO_VALUE : formatNumber(y)} tone={y === null ? "muted" : "ink"} caption={y === null ? "No value" : undefined} />
      </div>
    );
  }
  if (chart.kind === "bar") return <Bars chart={chart} className={className} />;
  return <Line chart={chart} className={className} />;
}

/**
 * Bars: one row per point, the name in a column as wide as the longest (up to 9rem), then the bar in the accent and its
 * value right at the bar's end. A bar's length is its share of the largest value, measured on the room left once the
 * value is set, so the longest bar and its figure always fit the tile. No entrance animation: a bar is drawn at its
 * length from the first frame, so a page captured or printed early never shows the figures without their bars.
 */
function Bars({ chart, className }: { chart: AskChart; className?: string }) {
  const series = chart.series.slice(0, 3);
  const points = series[0]?.points.slice(0, MAX_BARS) ?? [];
  const max = Math.max(1, ...series.flatMap((s) => s.points.slice(0, MAX_BARS).map((p) => p.y ?? 0)));
  const top = Math.max(...points.map((p) => p.y ?? 0));
  const description = points.map((p, i) => `${label(p.x)} ${series.map((s) => formatNumber(s.points[i]?.y ?? 0)).join(" / ")}`).join(", ");
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {series.length > 1 && <Legend names={series.map((s) => s.name)} />}
      <div role="img" aria-label={`${series.map((s) => s.name).join(" and ")}: ${description}`} className="grid grid-cols-chart-row items-center gap-x-3 gap-y-1.5">
        {points.map((p, i) => (
          <div key={i} className="contents">
            <span className="truncate text-sm text-ink-muted" title={label(p.x)}>
              {label(p.x)}
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              {series.map((s, j) => {
                const y = s.points[i]?.y ?? 0;
                const share = Math.max(0, y) / max;
                return (
                  <div key={s.name} data-bar="" className="flex min-w-0 items-center gap-2">
                    <span
                      aria-hidden
                      data-share={Math.round(share * 100)}
                      className={cn("block h-4 shrink-0 rounded-xxs", FILLS[j])}
                      style={{ width: `max(2px, calc((100% - ${VALUE_ROOM}) * ${round(share)}))` }}
                    />
                    <span className={cn("shrink-0 text-sm tabular-nums", y === top ? "font-semibold text-ink" : "text-ink-body")}>{formatNumber(y)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The room kept at a bar's end for its value ("12,345"), so the longest bar and its figure share the row. */
const VALUE_ROOM = "4.5rem";

function Legend({ names }: { names: string[] }) {
  return (
    <ul aria-label="Series" className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-body">
      {names.map((n, i) => (
        <li key={n} className="flex items-center gap-1.5">
          <span aria-hidden className={cn("size-2.5 rounded-full", FILLS[i])} />
          {n}
        </li>
      ))}
    </ul>
  );
}

/** A length for a style, to four places: no float noise in the markup. */
const round = (v: number) => Math.round(v * 10_000) / 10_000;

const W = 600;
const H = 200;
const PAD = 8;

/** Room for one label along a line's bottom ("21 Nov"), in pixels. */
const LABEL_ROOM = 64;

/** An element's width, kept current as it changes size. */
function useWidth(): [(el: HTMLDivElement | null) => void, number] {
  const [width, setWidth] = useState(0);
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (!el || typeof ResizeObserver === "undefined") return;
    // It reports the first size as soon as it starts observing.
    const ro = new ResizeObserver(() => setWidth(el.getBoundingClientRect().width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, width];
}

/**
 * At most `most` of `n` points, at one even stride, always the first and the last: a point too close to the last (less
 * than a stride before it) is left out, so no two labels are nearer than a stride.
 */
function spread(n: number, most: number): number[] {
  if (n <= most) return Array.from({ length: n }, (_, i) => i);
  const stride = Math.ceil((n - 1) / (most - 1));
  const out: number[] = [];
  for (let i = 0; i < n - 1; i += stride) if (n - 1 - i >= stride) out.push(i);
  out.push(n - 1);
  return out;
}

/**
 * A line: light gridlines at round values with their figures beside them, the day (or whatever runs along) under every
 * point that has room, and a dot per point that says its value on hover. The axis starts at zero.
 */
function Line({ chart, className }: { chart: AskChart; className?: string }) {
  const series = chart.series.slice(0, 3);
  const n = Math.min(MAX_POINTS, Math.max(...series.map((s) => s.points.length)));
  const values = series.flatMap((s) => s.points.slice(0, n).map((p) => p.y ?? 0));
  const step = niceStep(Math.max(1, ...values) - Math.min(0, ...values));
  const max = Math.max(step, Math.ceil(Math.max(1, ...values) / step) * step);
  const min = Math.min(0, Math.floor(Math.min(0, ...values) / step) * step);
  const ticks: number[] = [];
  for (let v = min; v <= max + step / 2; v += step) ticks.push(v);
  const xAt = (i: number) => (n <= 1 ? 0.5 : i / (n - 1));
  const yAt = (v: number) => (v - min) / (max - min || 1);
  const x = (i: number) => PAD + xAt(i) * (W - 2 * PAD);
  const y = (v: number) => H - PAD - yAt(v) * (H - 2 * PAD);
  const xs = series[0]?.points.slice(0, n) ?? [];
  // As many labels along the bottom as the plot has room for, about 4rem each, so they never run into each other.
  const [plot, width] = useWidth();
  const labelled = spread(xs.length, Math.max(2, Math.min(7, Math.floor(width / LABEL_ROOM) || 2)));
  const dots = n <= 31;
  // Where a point sits in the plot's box, as percentages of its width and height (the SVG keeps PAD inside it).
  const left = (i: number) => `${round((x(i) / W) * 100)}%`;
  const topOf = (v: number) => `${round((y(v) / H) * 100)}%`;
  const description = series.map((s) => `${s.name}: ${s.points.slice(0, n).map((p) => `${label(p.x)} ${formatNumber(p.y ?? 0)}`).join(", ")}`).join("; ");
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {series.length > 1 && <Legend names={series.map((s) => s.name)} />}
      <div className="flex items-stretch gap-2">
        <div className="relative h-48 w-10 shrink-0 text-xs tabular-nums text-ink-muted" aria-hidden>
          {ticks.map((t) => (
            <span key={t} data-tick="" className="absolute right-0 -translate-y-1/2 whitespace-nowrap" style={{ top: topOf(t) }}>
              {formatNumber(t)}
            </span>
          ))}
        </div>
        <div ref={plot} className="relative h-48 min-w-0 flex-1">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={description} className="block size-full overflow-visible">
            {ticks.map((t) => (
              <line key={t} x1={0} x2={W} y1={y(t)} y2={y(t)} vectorEffect="non-scaling-stroke" className={cn("stroke-1", t === 0 ? "stroke-border-strong" : "stroke-border")} />
            ))}
            {series.map((s, j) => (
              <polyline
                key={s.name}
                fill="none"
                vectorEffect="non-scaling-stroke"
                className={cn(STROKES[j], "stroke-2")}
                strokeLinejoin="round"
                strokeLinecap="round"
                points={s.points
                  .slice(0, n)
                  .map((p, i) => `${x(i)},${y(p.y ?? 0)}`)
                  .join(" ")}
              />
            ))}
          </svg>
          {dots &&
            series.map((s, j) =>
              s.points.slice(0, n).map((p, i) => (
                // A dot per point, with a hit area larger than it; hovering it says the point's value.
                <span key={`${j}-${i}`} data-point="" className="group absolute flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center" style={{ left: left(i), top: topOf(p.y ?? 0) }}>
                  <span aria-hidden className={cn("size-2 rounded-full border-2 border-surface", FILLS[j])} />
                  <span role="tooltip" className="pointer-events-none absolute bottom-full z-10 mb-1 hidden whitespace-nowrap rounded-xs border bg-surface px-2 py-1 text-xs text-ink shadow-raised group-hover:block">
                    {label(p.x)}: <span className="font-semibold tabular-nums">{formatNumber(p.y ?? 0)}</span>
                  </span>
                </span>
              )),
            )}
        </div>
      </div>
      <div className="relative ml-12 h-4 text-xs text-ink-muted" aria-hidden>
        {labelled.map((i) => (
          <span
            key={i}
            data-xlabel=""
            className={cn("absolute whitespace-nowrap", i === 0 ? "" : i === xs.length - 1 ? "-translate-x-full" : "-translate-x-1/2")}
            style={{ left: i === 0 ? 0 : i === xs.length - 1 ? "100%" : left(i) }}
          >
            {label(xs[i]?.x)}
          </span>
        ))}
      </div>
    </div>
  );
}

function AnswerTable({ columns, rows, className }: { columns: string[]; rows: Record<string, unknown>[]; className?: string }) {
  const cols = columns.length > 0 ? columns : Object.keys(rows[0] ?? {});
  if (rows.length === 0) return <p className={cn("text-ink-muted", className)}>No rows came back.</p>;
  const shown = rows.slice(0, 50);
  // The house table: numbers right-aligned in figure columns, and below its own width threshold a list of cards, so a
  // narrow tile never squeezes its columns. The more columns, the wider it must be before it is drawn as a table.
  const table: Column[] = cols.map((c, i) => ({ key: c, header: c.replace(/_/g, " "), kind: i === 0 ? "grow" : shown.every((r) => r[c] === null || r[c] === undefined || typeof r[c] === "number") ? "figure" : "text" }));
  const at = cols.length <= 2 ? "narrow" : cols.length <= 4 ? "medium" : "wide";
  return (
    <Table label="The answer's rows" columns={table} at={at} className={className}>
      {shown.map((r, i) => (
        <TableRow key={i}>
          {cols.map((c, j) => (
            <Cell key={c} col={c} primary={j === 0}>
              {cell(r[c])}
            </Cell>
          ))}
        </TableRow>
      ))}
    </Table>
  );
}
