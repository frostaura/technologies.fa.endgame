import { createContext, useContext, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { cn } from "@/lib/utils";

/**
 * The figure tile: every "big number" in the console is one of these (ARCH-011).
 *
 * The value slot holds only a short value — a number, a few characters such as "73%" or "—", or one
 * short word. Anything longer ("Not measured yet", "Usually 53% under the estimate") is the caption,
 * and the value is "—" or the bare figure. Values are set in the body face with tabular lining
 * figures, so columns of numbers line up and the display face's hooked "1" never reaches a figure.
 *
 * In a {@link StatRow} every tile has the same slots in the same places: label, value, meter (reserved
 * in every tile when any tile in the row has one), caption. Captions therefore start on one line.
 *
 * Two looks only: boxed (a tile of its own) and `plain` (in a hero or a card already drawn). A value is
 * NEVER cut with an ellipsis: when its slot is too narrow its type steps down until it fits. A label wraps
 * rather than being cut. A caption is one line from `sm` up (cut with its whole text in the tooltip, the
 * explanation belonging in the alert or text beside it); on a phone, where there is no tooltip to read, it
 * wraps instead and is never cut. It is the tile's last slot, so a caption that wraps moves nothing above it:
 * sibling tiles keep their tops, their values and their meters on the same lines.
 * Numbers come from `formatNumber` (one precision rule, a true minus sign).
 */

/** The caption: one line from `sm` up, wrapping (never cut) on a phone. Exported only for the guard test. */
export const STAT_CAPTION = "text-sm text-ink-body max-sm:break-words sm:truncate";

/** The value classes, exported only so the guard test can name them; use {@link Stat}. */
export const STAT_VALUE = {
  md: "text-2xl max-sm:text-xl",
  lg: "text-3xl max-sm:text-2xl",
  xl: "text-5xl max-sm:text-4xl",
} as const;

const RowContext = createContext<{ meters: boolean } | null>(null);

/** "—": what a figure slot shows when there is nothing measured to show. */
export const NO_VALUE = "—";

export function Stat({
  label,
  value,
  caption,
  meter,
  size = "md",
  tone = "ink",
  plain = false,
  valueAs: Value = "span",
  className,
  testId,
}: {
  /** The page's own title is a figure on one page (the balance): it is then the h1. */
  valueAs?: "span" | "h1";
  label: ReactNode;
  /** A short value only. Explanations go in `caption`. */
  value: ReactNode;
  caption?: ReactNode;
  /** A meter under the value: a percentage (0–100+) and what it says aloud. */
  meter?: { value: number; label: string; tone?: "primary" | "bad" } | null;
  size?: keyof typeof STAT_VALUE;
  /** `good` and `bad` colour the value; used sparingly, for money not charged or a balance below zero. */
  tone?: "ink" | "muted" | "good" | "bad";
  /** No card of its own: a figure inside a hero or a card that is already drawn. */
  plain?: boolean;
  className?: string;
  testId?: string;
}) {
  const row = useContext(RowContext);
  const reserve = meter != null || row?.meters;
  const valueRef = useFitValue();
  return (
    <div
      data-testid={testId}
      className={cn(
        "flex min-w-0 flex-col gap-1",
        !plain && "rounded-md border bg-surface px-5 py-4 shadow-card max-sm:px-3.5 max-sm:py-3",
        className,
      )}
    >
      <span className="break-words text-sm text-ink-muted">{label}</span>
      <Value
        ref={valueRef}
        data-stat-value=""
        className={cn(
          "block overflow-hidden whitespace-nowrap font-sans font-semibold leading-tight tracking-tight tabular-nums",
          STAT_VALUE[size],
          { ink: "text-ink", muted: "text-ink-muted", good: "text-success-text", bad: "text-attention-text" }[tone],
        )}
      >
        {value}
      </Value>
      {reserve && (
        <span aria-hidden={meter == null} className="flex h-4 items-center">
          {meter != null && <Meter {...meter} />}
        </span>
      )}
      {caption && (
        <span data-stat-caption="" title={typeof caption === "string" ? caption : undefined} className={STAT_CAPTION}>
          {caption}
        </span>
      )}
    </div>
  );
}

/**
 * A value that never ellipsises: while it is wider than its slot its type steps down (to no less than 12px),
 * re-measured whenever the slot changes size.
 */
function useFitValue() {
  const ref = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.fontSize = "";
      let size = parseFloat(getComputedStyle(el).fontSize) || 24;
      while (el.scrollWidth > el.clientWidth + 0.5 && size > 12) {
        size = Math.max(12, size * 0.9);
        el.style.fontSize = `${size}px`;
      }
    };
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  });
  return ref as RefObject<HTMLSpanElement & HTMLHeadingElement>;
}

/**
 * A meter is drawn at its real width from the first frame — a page captured, printed or seen as it opens never shows an
 * empty track — and eases to a new width when its value changes (no motion under reduced motion). Exported for the tests.
 */
export const METER_FILL = "block h-full rounded-full transition-width duration-500 ease-out motion-reduce:transition-none";

function Meter({ value, label, tone = "primary" }: { value: number; label: string; tone?: "primary" | "bad" }) {
  return (
    <span role="img" aria-label={label} className="block h-2 w-full overflow-hidden rounded-full bg-border">
      <span
        data-meter-fill=""
        className={cn(METER_FILL, tone === "bad" ? "bg-attention-text" : "bg-primary")}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </span>
  );
}

const COLS = {
  2: "grid-cols-2",
  3: "grid-cols-2 sm:grid-cols-3",
  4: "grid-cols-2 xl:grid-cols-4",
} as const;

/**
 * A row of figure tiles with a fixed number of equal slots. `meters`: some tile in the row has a meter,
 * so every tile keeps its place and the captions stay aligned.
 */
export function StatRow({ cols, meters = false, label, className, children }: { cols: keyof typeof COLS; meters?: boolean; label?: string; className?: string; children: ReactNode }) {
  return (
    <RowContext.Provider value={{ meters }}>
      <section aria-label={label} className={cn("grid items-stretch gap-3 sm:gap-4", COLS[cols], className)}>
        {children}
      </section>
    </RowContext.Provider>
  );
}
