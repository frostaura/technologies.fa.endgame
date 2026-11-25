import { href } from "../lib/router.ts";
import { Page } from "../components/Shell.tsx";

export function NotFound() {
  return (
    <Page className="max-w-read">
      <h1 className="font-display text-title-sm font-bold text-ink">There is no page here</h1>
      <p className="mt-4 text-lead text-ink-body">The address may be from an older version of the academy. Search for what you were after, or start from the cover.</p>
      <a href={href("/")} className="mt-8 inline-flex min-h-touch items-center rounded-full bg-primary px-6 text-sm font-semibold text-primary-ink">Back to the cover</a>
    </Page>
  );
}
