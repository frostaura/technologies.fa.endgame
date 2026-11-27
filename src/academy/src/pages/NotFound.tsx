import { CLIENT_LEVELS } from "../content/types.ts";
import { href } from "../lib/router.ts";
import { Eyebrow, Page } from "../components/Shell.tsx";
import { Search } from "../components/Search.tsx";
import { ui } from "../components/ui.ts";

/** An address with no page: on the page grid, with search and the four paths to go on from. */
export function NotFound() {
  return (
    <Page className="lg:flex lg:min-h-player lg:flex-col lg:justify-center">
      <Eyebrow>Not found</Eyebrow>
      <h1 className="mt-3 font-display text-title-sm font-bold text-ink sm:text-title">There is no page here</h1>
      <p className="mt-4 max-w-read text-lead-sm text-ink-body sm:text-lead">The address may be from an older version of the academy. Search for what you were after, or start from a path.</p>
      <div className="mt-8 max-w-read"><Search /></div>
      <ul className="mt-8 flex flex-wrap gap-2">
        {CLIENT_LEVELS.map((l) => <li key={l}><a href={href(`/path/${l}`)} className={ui.quiet}>{l}</a></li>)}
      </ul>
      <a href={href("/")} className={`${ui.primary} mt-8 self-start px-6`}>Back to the cover</a>
    </Page>
  );
}
