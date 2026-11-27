import { useState } from "react";
import { site } from "../lib/data.ts";
import { Qr } from "./Qr.tsx";
import { ui } from "./ui.ts";
import { Breakable } from "./Breakable.tsx";

/**
 * The academy's address to hand on: on a computer, a card with its QR code to scan with a phone and a
 * button to copy the link; on a touch screen — already the phone — the QR is meaningless, so the card
 * offers the device's own Share (or copying the link) instead.
 */
export function ShareCard({ className = "" }: { className?: string }) {
  const [copied, setCopied] = useState(false);
  const url = site.siteUrl;
  const copy = () =>
    void navigator.clipboard?.writeText(url).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  const share = () => {
    if (typeof navigator.share === "function") void navigator.share({ title: "The Endgame Academy", url }).catch(() => undefined);
    else copy();
  };
  const shown = url.replace(/^https?:\/\//, "");
  return (
    <section aria-label="Share the academy" className={`${ui.card} p-5 sm:p-6 ${className}`} data-testid="share-card">
      <div className="flex items-start gap-5">
        <Qr size="sm" className="hidden mouse:flex" />
        <div className="min-w-0 flex-1">
          <p className={`${ui.eyebrow} text-primary`}>Share it</p>
          <p className="mt-1.5 text-balance font-display text-lg font-semibold text-ink"><span className="hidden mouse:inline">Scan to follow along on your phone</span><span className="mouse:hidden">Send the academy to someone</span></p>
          <p className="mt-2 font-mono text-xs text-ink-muted"><Breakable text={shown} /></p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={share} className={`${ui.quiet} mouse:hidden`}>Share</button>
            <button type="button" onClick={copy} className={ui.quiet} aria-live="polite">{copied ? "Link copied" : "Copy link"}</button>
          </div>
        </div>
      </div>
    </section>
  );
}
