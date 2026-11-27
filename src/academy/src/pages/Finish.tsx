import { href } from "../lib/router.ts";
import { Eyebrow, Page } from "../components/Shell.tsx";
import { ShareCard } from "../components/ShareCard.tsx";
import { PdfLinks } from "./Cover.tsx";
import { ui } from "../components/ui.ts";

/** The closing page: the address, its QR code and a link to copy, composed in one card to hand the academy on. */
export function Finish() {
  return (
    <Page className="lg:grid lg:min-h-player lg:content-center">
      <div className="grid gap-10 lg:grid-cols-12 lg:items-center lg:gap-16">
        <div className="lg:col-span-7">
          <Eyebrow>Thank you</Eyebrow>
          <h1 className="mt-3 font-display text-title-sm font-bold text-ink sm:text-title">Take Endgame with you</h1>
          <p className="mt-5 max-w-read text-lead-sm text-ink-body sm:text-lead">Share the academy with the people in your organisation. Everything here is built from the product's own flow documents, so it changes when the product does.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href={href("/learn")} className={`${ui.primary} px-6 text-base`}>Choose another path</a>
            <a href={href("/demo")} className={`${ui.outline} px-6 text-base`}>Open the live demo</a>
          </div>
          <PdfLinks className="mt-8" />
        </div>
        <ShareCard className="lg:col-span-5" />
      </div>
    </Page>
  );
}
