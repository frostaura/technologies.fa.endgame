import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Icon } from "@/components/Icon";
import { cn } from "@/lib/utils";
import { Link } from "@/components/Link";
import { paths, useLocation } from "@/lib/router";
import { useActiveOrganisation, useLeaveOrganisation } from "@/lib/useActiveOrganisation";

/**
 * Shown on every screen to a FrostAura operator, so they always know they are in God mode — and,
 * once they have entered an organisation, which one every screen is showing and that what they do
 * there is logged where its Owner can read it (CLAUDE.md rule 1, OP-04).
 */
export function GodModeBand() {
  const { pathname } = useLocation();
  const active = useActiveOrganisation();
  const leave = useLeaveOrganisation();
  const [open, setOpen] = useState(false);
  const detailId = useId();
  const inside = active.entered ? active.organisation : null;
  const sentence = inside
    ? `You are inside ${inside.name} as a FrostAura operator, acting as an Admin. Your entry and everything you change here are logged where its Owner can read them.`
    : "You are a FrostAura operator. Entering an organisation is logged where its Owner can read it.";
  const action = "inline-flex h-8 shrink-0 items-center rounded-xs px-1 font-semibold text-primary-ink underline underline-offset-2 touch:min-h-touch";
  // One 32px bar (44 where it is worked by touch): God mode, where you are, the way out, and the rest on a tap.
  return (
    <div role="note" aria-label="God mode" data-god-mode className="bg-attention-text text-sm text-primary-ink">
      <div className="flex min-h-8 items-center gap-x-3 px-4 sm:px-8">
        <span className="flex shrink-0 items-center gap-2 font-semibold uppercase tracking-wide">
          <Icon name="god-mode" className="size-4" />
          God mode
        </span>
        <span className="hidden min-w-0 flex-1 truncate sm:block" title={sentence}>
          {open ? (inside ? `Inside ${inside.name}` : "") : sentence}
        </span>
        <span className="flex-1 sm:hidden" />
        {inside && (
          <button type="button" onClick={() => leave()} className={action}>
            Leave {inside.name}
          </button>
        )}
        {(inside || pathname !== paths.operator()) && (
          <Link
            href={paths.operator()}
            // Going back to every organisation leaves the one entered.
            onClick={() => inside && leave(null)}
            className={cn(action, "max-sm:hidden")}
          >
            Every organisation
          </Link>
        )}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={detailId}
          aria-label={open ? "Hide what God mode means" : "What God mode means"}
          onClick={() => setOpen((x) => !x)}
          className="flex size-8 shrink-0 items-center justify-center rounded-xs touch:size-11"
        >
          <ChevronDown aria-hidden className={cn("size-4 transition-transform motion-reduce:transition-none", open && "rotate-180")} />
        </button>
      </div>
      <div id={detailId} hidden={!open} className={cn("flex flex-col items-start gap-1 px-4 pb-2 sm:px-8", !open && "hidden")}>
        <p>{sentence}</p>
        {(inside || pathname !== paths.operator()) && (
          <Link href={paths.operator()} onClick={() => inside && leave(null)} className={cn(action, "sm:hidden")}>
            Every organisation
          </Link>
        )}
      </div>
    </div>
  );
}
