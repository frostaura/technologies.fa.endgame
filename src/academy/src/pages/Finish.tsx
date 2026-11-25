import { href } from "../lib/router.ts";
import { Qr } from "../components/Qr.tsx";
import { Mark } from "../components/Mark.tsx";
import { Eyebrow } from "../components/Shell.tsx";

/** The closing page: the address and its QR code again, to hand the academy on. */
export function Finish() {
  return (
    <section className="mx-auto grid max-w-page items-center gap-12 px-4 py-16 sm:px-6 lg:min-h-stage lg:grid-cols-2">
      <div>
        <Mark className="h-12 w-12" />
        <div className="mt-8"><Eyebrow>Thank you</Eyebrow></div>
        <h1 className="mt-3 font-display text-cover-sm font-bold text-ink">Take Endgame with you</h1>
        <p className="mt-6 max-w-read text-lead text-ink-body">Share the academy with the people in your organisation. Everything here is built from the product's own flow documents, so it changes when the product does.</p>
        <div className="mt-10 flex flex-wrap gap-3">
          <a href={href("/learn")} className="inline-flex min-h-touch items-center rounded-full bg-primary px-6 text-base font-semibold text-primary-ink shadow-press hover:bg-primary-hover">Choose another path</a>
          <a href={href("/demo")} className="inline-flex min-h-touch items-center rounded-full border-2 border-ink px-6 text-base font-semibold text-ink hover:bg-ink hover:text-primary-ink">Open the live demo</a>
        </div>
      </div>
      <div className="flex justify-center lg:justify-end"><Qr /></div>
    </section>
  );
}
