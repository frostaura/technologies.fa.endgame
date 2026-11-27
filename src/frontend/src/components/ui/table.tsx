import { createContext, useContext, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { tableTracks, type tableAt } from "@/lib/tokens";

/**
 * The one table (ARCH-011). A header row and one row per item, every column in the same place, with one
 * header style (sentence case, small, muted, on the ground band) — and, when the table's OWN box is narrower
 * than its threshold (`at`, a container query: a table beside a side panel or a docked pane switches when it
 * has the room, wherever that is), the same rows as a list of cards: the primary cell as the row's title, and
 * every other cell under it with its column's name beside it. So a table never overprints its headers or
 * squeezes a cell to a word a line, at any width.
 *
 * Column sizing is fixed by kind, never by content, so every row lines up with the header:
 * `grow` (the name: twice a text column), `text`, `figure` (right-aligned, tabular), `status` (a tag),
 * `date`, `action` (what ends the row, right-aligned). `track` overrides one column's width when a page must.
 */
export type ColumnKind = "grow" | "text" | "figure" | "status" | "date" | "action";

export interface Column {
  key: string;
  header: string;
  kind?: ColumnKind;
  /** A CSS grid track for this column alone, when its kind's width does not fit (rare). */
  track?: string;
  /** Read out, but not drawn as a header (an action column). */
  hideHeader?: boolean;
}

const TRACK: Record<ColumnKind, string> = tableTracks;

const Columns = createContext<Column[]>([]);

export function Table({
  label,
  columns,
  at = "medium",
  className,
  children,
  testId,
}: {
  /** The list's accessible name ("People"). */
  label: string;
  columns: Column[];
  /** The table's width (its own box) below which its rows are cards. */
  at?: keyof typeof tableAt;
  className?: string;
  children: ReactNode;
  testId?: string;
}) {
  const style = { "--table-cols": columns.map((c) => c.track ?? TRACK[c.kind ?? "text"]).join(" ") } as CSSProperties;
  return (
    <Columns.Provider value={columns}>
      <div data-table="" data-at={at} data-testid={testId} style={style} className={cn("tbl-frame overflow-hidden rounded-md border bg-surface shadow-card", className)}>
        <div aria-hidden className="tbl-head gap-x-5 border-b bg-ground px-5 py-2.5 text-sm font-medium text-ink-muted">
          {columns.map((c) => (
            <span key={c.key} data-kind={c.kind ?? "text"} className="min-w-0 break-words leading-snug">
              {c.hideHeader ? "" : c.header}
            </span>
          ))}
        </div>
        <ul aria-label={label} className="flex flex-col divide-y">
          {children}
        </ul>
      </div>
    </Columns.Provider>
  );
}

/**
 * One row. Its cells come in the columns' order; `after` is drawn under the row across its whole width — a
 * confirmation or a short form the row's own control opened, so it sits right under that control.
 */
export function TableRow({ children, after, className, ...rest }: HTMLAttributes<HTMLLIElement> & { after?: ReactNode; [data: `data-${string}`]: string | undefined }) {
  return (
    <li className={cn("flex flex-col gap-3 px-5 py-3.5 max-sm:px-4", className)} {...rest}>
      <div className="tbl-row gap-x-5">{children}</div>
      {after}
    </li>
  );
}

/**
 * One cell, in column `col`. In the card form it shows its column's name before it, unless it is the row's
 * `primary` cell (the title) or an action.
 */
export function Cell({ col, primary = false, className, children }: { col: string; primary?: boolean; className?: string; children: ReactNode }) {
  const column = useContext(Columns).find((c) => c.key === col);
  const kind = column?.kind ?? "text";
  const labelled = !primary && kind !== "action" && !!column?.header;
  return (
    <div data-kind={kind} data-primary={primary || undefined} className={cn("tbl-cell min-w-0", className)}>
      {labelled && <span className="tbl-cell-label text-sm text-ink-muted">{column?.header}</span>}
      <div className="min-w-0">{children}</div>
    </div>
  );
}
