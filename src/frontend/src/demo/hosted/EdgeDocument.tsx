import { useEffect, useEffectEvent, useRef } from "react";
import { wireAuthPage, type AuthAction } from "./edgePages";

/**
 * One page the Edge serves, drawn in its own document so the platform's CSS and the console's
 * never meet. The iframe has no `src`: its initial blank document shares the console's origin (from
 * file:// as well), the page is written into it, and its links and forms are answered by `onAction`.
 */
export function EdgeDocument({
  html,
  docKey,
  title,
  prepare,
  onAction,
}: {
  html: string;
  /** Changes whenever `prepare` would draw the page differently: the page is written afresh. */
  docKey: string;
  title: string;
  /** Runs once the page is written, before anyone can touch it (the page script's start()). */
  prepare?: (doc: Document) => void;
  onAction: (action: AuthAction) => Promise<void>;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const setUp = useEffectEvent((doc: Document) => prepare?.(doc));
  const act = useEffectEvent((action: AuthAction) => onAction(action));

  useEffect(() => {
    const doc = frame.current?.contentDocument;
    if (!doc) return;
    doc.open();
    // A written about:blank page would refresh to a blank one: the view retries by redrawing instead.
    doc.write(html.replace(/\n<meta http-equiv="refresh"[^>]*>/, ""));
    doc.close();
    setUp(doc);
    return wireAuthPage(doc, (action) => act(action));
  }, [html, docKey]);

  return <iframe ref={frame} title={title} data-testid="edge-page" className="block w-full flex-1 border-0 bg-ground" />;
}
