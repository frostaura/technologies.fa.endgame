import { Icon } from "@/components/Icon";
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
  const inside = active.entered ? active.organisation : null;
  return (
    <div role="note" aria-label="God mode" data-god-mode className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-attention-text px-4 py-2 text-sm text-primary-ink sm:px-8">
      <span className="flex items-center gap-2 font-semibold uppercase tracking-wide">
        <Icon name="god-mode" className="size-4" />
        God mode
      </span>
      <span className="order-last min-w-0 basis-full sm:order-none sm:flex-1 sm:basis-auto">
        {inside
          ? `You are inside ${inside.name} as a FrostAura operator, acting as an Admin. Your entry and everything you change here are logged where its Owner can read them.`
          : "You are a FrostAura operator. Entering an organisation is logged where its Owner can read it."}
      </span>
      {inside && (
        <button
          type="button"
          onClick={() => leave()}
          className="inline-flex min-h-touch items-center rounded-xs px-1 font-semibold text-primary-ink underline underline-offset-2"
        >
          Leave {inside.name}
        </button>
      )}
      {(inside || pathname !== paths.operator()) && (
        <Link
          href={paths.operator()}
          // Going back to every organisation leaves the one entered.
          onClick={() => inside && leave(null)}
          className="ml-auto inline-flex min-h-touch items-center rounded-xs font-semibold text-primary-ink underline underline-offset-2 sm:ml-0"
        >
          Every organisation
        </Link>
      )}
    </div>
  );
}
