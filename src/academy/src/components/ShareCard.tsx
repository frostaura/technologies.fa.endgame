import { useState, type ReactNode } from "react";
import { site } from "../lib/data.ts";
import { Qr } from "./Qr.tsx";
import { ui } from "./ui.ts";
import { Breakable } from "./Breakable.tsx";

/**
 * The academy's address to hand on: on a computer, a card with its QR code to scan with a phone and a
 * button to copy the link; on a touch screen — already the phone — the QR is meaningless, so the card
 * offers the device's own Share (or copying the link) instead.
 */
export function ShareCard({ className = "", children, size = "sm" }: { className?: string; children?: ReactNode; size?: "sm" | "md" }) {
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
  // The address breaks after the host first; only a card too narrow for the path breaks it again, at a dot or a slash.
  const shown = url.replace(/^https?:\/\//, "");
  const cut = shown.indexOf("/") + 1;
  const [host, rest] = cut > 0 ? [shown.slice(0, cut), shown.slice(cut)] : [shown, ""];
  return (
    <section aria-label="Share the academy" className={`${ui.card} min-w-0 p-5 sm:p-6 ${className}`} data-testid="share-card">
      <div className="flex flex-wrap items-start gap-5">
        <Qr size={size} className="hidden mouse:flex" />
        <div className="min-w-0 flex-1 basis-56">
          <p className={`${ui.eyebrow} text-primary`}>Share it</p>
          <p className="mt-1.5 text-balance font-display text-lg font-semibold text-ink"><span className="hidden mouse:inline">Scan to follow along on your phone</span><span className="mouse:hidden">Send the academy to someone</span></p>
          <p className="mt-2 font-mono text-xs text-ink-muted"><span className="whitespace-nowrap">{host}</span>{rest && <wbr />}<Breakable text={rest} /></p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={share} className={`${ui.quiet} mouse:hidden`}>Share</button>
            <button type="button" onClick={copy} className={ui.quiet} aria-live="polite">{copied ? "Link copied" : "Copy link"}</button>
          </div>
          {children}
        </div>
      </div>
    </section>
  );
}
