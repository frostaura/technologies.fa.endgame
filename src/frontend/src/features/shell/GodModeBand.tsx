import { Icon } from "@/components/Icon";
import { Link } from "@/components/Link";
import { paths, useLocation } from "@/lib/router";

/**
 * Shown on every screen to a FrostAura operator, so they always know they are in God mode — and
 * that every organisation they enter is logged where its Owner can read it (CLAUDE.md rule 1).
 */
export function GodModeBand() {
  const { pathname, search } = useLocation();
  const entered = pathname === "/" ? search.get("organisation") : null;
  return (
    <div role="note" aria-label="God mode" data-god-mode className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-attention-text px-4 py-2 text-sm text-primary-ink sm:px-8">
      <span className="flex items-center gap-2 font-semibold uppercase tracking-wide">
        <Icon name="god-mode" className="size-4" />
        God mode
      </span>
      <span className="min-w-0 flex-1">
        {entered ? `You are inside ${entered} as a FrostAura operator. Your entry is logged where its Owner can read it.` : "You are a FrostAura operator. Entering an organisation is logged where its Owner can read it."}
      </span>
      {pathname !== paths.operator() && (
        <Link href={paths.operator()} className="inline-flex min-h-touch items-center rounded-xs font-semibold text-primary-ink underline underline-offset-2">
          Every organisation
        </Link>
      )}
    </div>
  );
}
