import { CLIENT_LEVELS } from "../content/types.ts";
import { track } from "../lib/data.ts";
import { LEVEL_BLURB } from "../lib/labels.ts";
import { href } from "../lib/router.ts";
import { Page } from "../components/Shell.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { ui } from "../components/ui.ts";

/**
 * An address with no page: what happened on the left, and the four paths to go on from as cards that
 * take the rest of the width. Search is the header's own box; the page adds no second one.
 */
export function NotFound() {
  return (
    <Page>
      <div className="grid gap-10 lg:grid-cols-about lg:items-start lg:gap-16">
        <PageHeader eyebrow="Not found" title="There is no page here" lede="The address may be from an older version of the academy. Search for what you were after from the header, or start from a path.">
          <a href={href("/")} className={`${ui.primary} mt-8 px-6`}>Back to the cover</a>
        </PageHeader>
        <div className="min-w-0 lg:mt-9">
          <h2 className="font-display text-xl font-semibold text-ink">Start from a path</h2>
          <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {CLIENT_LEVELS.map((l, i) => (
              <li key={l} className="min-w-0">
                <a href={href(`/path/${l}`)} className={ui.cardLink}>
                  <span className="flex items-baseline gap-3">
                    <span className="text-sm font-semibold tabular-nums text-ink-muted">0{i + 1}</span>
                    <span className="font-display text-lg font-semibold text-ink group-hover:text-primary-link">{l}</span>
                    <span className="ml-auto text-xs tabular-nums text-ink-muted">{track(l)?.flows.length ?? 0} flows</span>
                  </span>
                  <span className="mt-1.5 text-sm text-ink-muted">{LEVEL_BLURB[l]}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Page>
  );
}
