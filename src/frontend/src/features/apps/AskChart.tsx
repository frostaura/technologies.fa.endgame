import { formatNumber } from "@/lib/format";
import { NO_VALUE, Stat } from "@/components/ui/stat";
import { cn } from "@/lib/utils";
import type { AskChart } from "@/store/types";

/**
 * An answer's chart, drawn from the chart spec the control plane returns: a single number, bars,
 * a line or a table. Every chart carries a text alternative that reads the same figures.
 */

const MAX_BARS = 24;
const MAX_POINTS = 120;

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
        <Stat plain size="lg" label={label(chart.series[0]?.name ?? "Value")} value={y === null ? NO_VALUE : formatNumber(y)} tone={y === null ? "muted" : "ink"} caption={y === null ? "No value" : undefined} />
      </div>
    );
  }
  if (chart.kind === "bar") return <Bars chart={chart} className={className} />;
  return <Line chart={chart} className={className} />;
}

function Bars({ chart, className }: { chart: AskChart; className?: string }) {
  const series = chart.series.slice(0, 3);
  const points = series[0]?.points.slice(0, MAX_BARS) ?? [];
  const max = Math.max(1, ...series.flatMap((s) => s.points.slice(0, MAX_BARS).map((p) => p.y ?? 0)));
  const top = Math.max(...points.map((p) => p.y ?? 0));
  const fills = ["bg-primary", "bg-violet", "bg-teal"];
  const description = points.map((p, i) => `${label(p.x)} ${series.map((s) => formatNumber(s.points[i]?.y ?? 0)).join(" / ")}`).join(", ");
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {series.length > 1 && <Legend names={series.map((s) => s.name)} />}
      <div role="img" aria-label={`${series.map((s) => s.name).join(" and ")}: ${description}`} className="grid grid-cols-chart-row items-center gap-x-3 gap-y-2">
        {/* One grid for every row: the names' column is as wide as the longest name (up to 9rem), so the bars start together, right after them. */}
        {points.map((p, i) => (
          <div key={i} className="contents">
            <span className="truncate text-ink-muted" title={label(p.x)}>
              {label(p.x)}
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              {series.map((s, j) => {
                const y = s.points[i]?.y ?? 0;
                return (
                  <div key={s.name} className="flex min-w-0 items-center gap-2">
                    <div
                      className={cn("h-3.5 origin-left animate-grow rounded-xxs motion-reduce:animate-none", series.length > 1 ? fills[j] : y === top ? "bg-primary" : "bg-primary-soft")}
                      style={{ width: `${Math.max(1, (y / max) * 100)}%` }}
                    />
                    <span className={cn("shrink-0 text-sm", y === top && "font-semibold")}>{formatNumber(y)}</span>
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

function Legend({ names }: { names: string[] }) {
  const dots = ["bg-primary", "bg-violet", "bg-teal"];
  return (
    <ul aria-label="Series" className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-body">
      {names.map((n, i) => (
        <li key={n} className="flex items-center gap-1.5">
          <span aria-hidden className={cn("size-2.5 rounded-full", dots[i])} />
          {n}
        </li>
      ))}
    </ul>
  );
}

const W = 600;
const H = 200;
const PAD = 8;

function Line({ chart, className }: { chart: AskChart; className?: string }) {
  const series = chart.series.slice(0, 3);
  const n = Math.min(MAX_POINTS, Math.max(...series.map((s) => s.points.length)));
  const values = series.flatMap((s) => s.points.slice(0, n).map((p) => p.y ?? 0));
  const max = Math.max(1, ...values);
  const min = Math.min(0, ...values);
  const x = (i: number) => PAD + (n <= 1 ? (W - 2 * PAD) / 2 : (i / (n - 1)) * (W - 2 * PAD));
  const y = (v: number) => H - PAD - ((v - min) / (max - min || 1)) * (H - 2 * PAD);
  const strokes = ["stroke-primary", "stroke-violet", "stroke-teal"];
  const first = series[0]?.points[0];
  const last = series[0]?.points[Math.min(n, series[0]?.points.length ?? 0) - 1];
  const description = series.map((s) => `${s.name}: ${s.points.slice(0, n).map((p) => `${label(p.x)} ${formatNumber(p.y ?? 0)}`).join(", ")}`).join("; ");
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {series.length > 1 && <Legend names={series.map((s) => s.name)} />}
      <div className="flex items-stretch gap-2">
        <div className="flex flex-col justify-between text-xs text-ink-muted" aria-hidden>
          <span>{formatNumber(max)}</span>
          <span>{formatNumber(min)}</span>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={description} className="h-48 w-full min-w-0 overflow-visible rounded-xs bg-ground">
          {series.map((s, j) => (
            <polyline
              key={s.name}
              fill="none"
              vectorEffect="non-scaling-stroke"
              className={cn(strokes[j], "stroke-2")}
              strokeLinejoin="round"
              strokeLinecap="round"
              points={s.points
                .slice(0, n)
                .map((p, i) => `${x(i)},${y(p.y ?? 0)}`)
                .join(" ")}
            />
          ))}
        </svg>
      </div>
      <div className="flex justify-between pl-8 text-xs text-ink-muted" aria-hidden>
        <span>{label(first?.x)}</span>
        <span>{label(last?.x)}</span>
      </div>
    </div>
  );
}

function AnswerTable({ columns, rows, className }: { columns: string[]; rows: Record<string, unknown>[]; className?: string }) {
  const cols = columns.length > 0 ? columns : Object.keys(rows[0] ?? {});
  if (rows.length === 0) return <p className={cn("text-ink-muted", className)}>No rows came back.</p>;
  return (
    // The table scrolls inside its own box on a phone; the page never does.
    <div className={cn("max-w-full overflow-x-auto rounded-xs border", className)}>
      <table className="w-full text-left text-sm">
        <thead className="bg-ground text-ink-muted">
          <tr>
            {cols.map((c) => (
              <th key={c} scope="col" className="whitespace-nowrap px-3 py-2 font-medium">
                {c.replace(/_/g, " ")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 50).map((r, i) => (
            <tr key={i} className="border-t">
              {cols.map((c) => (
                <td key={c} className="whitespace-nowrap px-3 py-2">
                  {cell(r[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
