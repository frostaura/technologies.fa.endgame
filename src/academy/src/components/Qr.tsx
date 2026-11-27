import { site } from "../lib/data.ts";

/**
 * The site's address as a QR code, generated at build from SITE_URL (no external service) and
 * drawn in the ink colour on a white tile with its quiet zone, so any phone can read it.
 */
export function Qr({ size = "md", className = "", caption = false }: { size?: "md" | "sm"; className?: string; caption?: boolean }) {
  const { qr, siteUrl } = site;
  const pad = 4;
  return (
    <figure className={`shrink-0 flex-col items-center gap-3 ${className.includes("hidden") ? "" : "flex"} ${className}`}>
      <div className="rounded-md border bg-surface p-2" data-testid="qr">
        <svg
          viewBox={`${-pad} ${-pad} ${qr.size + pad * 2} ${qr.size + pad * 2}`}
          className={`${size === "md" ? "w-qr" : "w-qr-sm"} block h-auto text-ink`}
          role="img"
          aria-label={`QR code for ${siteUrl}`}
          shapeRendering="crispEdges"
        >
          <rect x={-pad} y={-pad} width={qr.size + pad * 2} height={qr.size + pad * 2} className="fill-surface" />
          <path d={qr.path} fill="currentColor" />
        </svg>
      </div>
      {caption && <figcaption className="max-w-full break-all text-center font-mono text-xs text-ink-muted">{siteUrl.replace(/^https?:\/\//, "")}</figcaption>}
    </figure>
  );
}
