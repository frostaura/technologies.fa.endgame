import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Avatar } from "../Avatar";

/**
 * Chips (ARCH-011): a chip is one line. It never wraps — a label too long for its room is cut short with
 * the whole of it in the tooltip — and it is solid: a dashed outline is for a drop zone, never for a
 * thing that exists. A status is a `Badge` (the status tag), not a chip. One height: 32px (44 where it is
 * pressed by touch), one tone (the ground fill). Pills are chips; a button is never a pill.
 */

/** The look of every chip, for a control that has to be its own element (a link, a select). */
export const CHIP = "inline-flex max-w-full min-w-0 shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-ground text-sm text-ink";

/** A plain chip: a name, a count, a setting. */
export function Chip({ children, icon, title, className }: { children: ReactNode; icon?: ReactNode; title?: string; className?: string }) {
  return (
    <span title={title ?? (typeof children === "string" ? children : undefined)} className={cn(CHIP, "h-8 px-3", className)}>
      {icon}
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

/**
 * A person: their avatar (coloured from their stable id, so the same person is the same colour on
 * every screen), their name and what they do, and anything after (a status tag). Pressable when it
 * selects them.
 */
export function PersonChip({
  name,
  id,
  label,
  selected,
  onSelect,
  title,
  after,
  className,
}: {
  name: string;
  /** The person's stable id: what their colour is derived from. */
  id: string;
  /** What the chip says; their name by default ("Ruth · Software engineer"). */
  label?: string;
  selected?: boolean;
  onSelect?: () => void;
  title?: string;
  after?: ReactNode;
  className?: string;
}) {
  const text = label ?? name;
  const body = (
    <>
      <Avatar name={name} seed={id} size="xs" />
      <span className="min-w-0 truncate">{text}</span>
      {after}
    </>
  );
  const look = cn(CHIP, "h-8 pl-1 pr-3", onSelect && "touch:h-auto touch:min-h-touch", className);
  if (!onSelect)
    return (
      <span title={title ?? text} className={look}>
        {body}
      </span>
    );
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      title={title ?? text}
      className={cn(look, "relative z-10 transition-colors hover:bg-primary-tint", selected && "bg-primary-tint ring-2 ring-primary")}
    >
      {body}
    </button>
  );
}
