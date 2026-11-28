import { href } from "../lib/router.ts";
import { Page } from "../components/Shell.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { ShareCard } from "../components/ShareCard.tsx";
import { PdfLinks } from "./Cover.tsx";
import { ui } from "../components/ui.ts";
import { PDFS } from "../lib/site.ts";

/**
 * The closing page, from the top of the page like every other: what to do next on the left, and the
 * academy to hand on — its QR code at full size, its address, a link to copy and both PDFs — in one
 * card on the right that takes the rest of the width.
 */
export function Finish() {
  return (
    <Page>
      <div className="grid gap-10 lg:grid-cols-about lg:items-start lg:gap-16">
        <PageHeader eyebrow="Thank you" title="Take Endgame with you" lede="Share the academy with the people in your organisation. Everything here is built from the product's own flow documents, so it changes when the product does.">
          <div className="mt-8 flex flex-wrap gap-3">
            <a href={href("/learn")} className={`${ui.primary} px-6 text-base`}>Choose another path</a>
            <a href={href("/demo")} className={`${ui.outline} px-6 text-base`}>Open the live demo</a>
          </div>
        </PageHeader>
        <ShareCard size="md" className="lg:mt-9">
          {PDFS && (
            <div className="mt-6 border-t pt-5">
              <p className="text-sm font-medium text-ink">Read it offline</p>
              <p className="mt-1 text-sm text-ink-muted">Every flow, step by step, as a document to keep. The operator handbook is for FrostAura alone.</p>
              <PdfLinks className="mt-3" />
            </div>
          )}
        </ShareCard>
      </div>
    </Page>
  );
}
