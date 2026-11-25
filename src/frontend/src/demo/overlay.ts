import { noteCost, placeNote, ringBox, ringInsets, type Box } from "./placement";

/**
 * The academy's marks on the page: a spotlight ring around a control, with an optional note, and
 * a soft cursor that moves to what a step acts on. Both are drawn above the console, never take a
 * click (`pointer-events: none`), and follow the control as the page scrolls or reflows.
 */

let ring: HTMLDivElement | null = null;
let note: HTMLDivElement | null = null;
let cursor: HTMLDivElement | null = null;
let tracked: HTMLElement | null = null;
let frame = 0;

function layer(className: string): HTMLDivElement {
  const el = document.createElement("div");
  el.setAttribute("data-demo-chrome", "");
  el.setAttribute("aria-hidden", "true");
  el.className = className;
  document.body.appendChild(el);
  return el;
}

/**
 * Where an element sits in the demo's own page: an Edge page is drawn in a frame, so its controls'
 * boxes are moved by the frame's own place on the page.
 */
export function pageRect(el: Element): { left: number; top: number; width: number; height: number; bottom: number } {
  const r = el.getBoundingClientRect();
  let left = r.left;
  let top = r.top;
  // Out to the demo's own page, and no further: embedded, the demo is itself in the academy's frame.
  let win = el.ownerDocument.defaultView;
  while (win && win !== window && win.frameElement) {
    const frame = win.frameElement;
    const f = frame.getBoundingClientRect();
    left += f.left + frame.clientLeft;
    top += f.top + frame.clientTop;
    win = frame.ownerDocument.defaultView;
  }
  return { left, top, width: r.width, height: r.height, bottom: top + r.height };
}

/**
 * What the page shows inside the viewport: each run of words and each control, image or chart, in
 * the demo's own page coordinates (an Edge page's frame included). The note is set where it hides
 * least of these, and the ring stands clear of them.
 */
function contentBoxes(): Box[] {
  const out: Box[] = [];
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const push = (r: DOMRect, dx: number, dy: number) => {
    if (r.width * r.height < 4) return;
    const b = { left: r.left + dx, top: r.top + dy, right: r.right + dx, bottom: r.bottom + dy };
    if (b.right <= 0 || b.bottom <= 0 || b.left >= vw || b.top >= vh) return;
    out.push(b);
  };
  const visit = (doc: Document, dx: number, dy: number) => {
    if (!doc.body) return;
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.nodeValue?.trim() && !n.parentElement?.closest("[data-demo-chrome], script, style, title") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    const range = doc.createRange();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) push(r, dx, dy);
    }
    for (const el of doc.querySelectorAll("input, textarea, select, button, img, canvas, video, svg, [role=img], [role=progressbar]")) {
      if (el.closest("[data-demo-chrome]") || el.parentElement?.closest("svg")) continue;
      push(el.getBoundingClientRect(), dx, dy);
    }
    for (const frame of doc.querySelectorAll("iframe")) {
      try {
        const inner = frame.contentDocument;
        const f = frame.getBoundingClientRect();
        if (inner) visit(inner, dx + f.left + frame.clientLeft, dy + f.top + frame.clientTop);
      } catch {
        // A frame from another origin: its contents are its own.
      }
    }
  };
  visit(document, 0, 0);
  return out;
}

let refind: (() => HTMLElement | null) | null = null;
let lostSince = 0;
let placed: { key: string; at: number; left: number; top: number; score: number; ring: Box } | null = null;

function place() {
  frame = 0;
  if (!tracked || !ring) return;
  if (!tracked.isConnected) {
    // The screen drew it again (a refresh, a retry): the ring follows the new one, and waits a while for it.
    const again = refind?.();
    if (again) {
      tracked = again;
      tracked.setAttribute("data-demo-ringed", "");
    }
    else {
      lostSince ||= performance.now();
      if (performance.now() - lostSince > 10_000) {
        clearSpotlight();
        return;
      }
      ring.hidden = true;
      if (note) note.hidden = true;
      frame = requestAnimationFrame(place);
      return;
    }
  }
  lostSince = 0;
  ring.hidden = false;
  if (note) note.hidden = false;
  const r = pageRect(tracked);
  const target: Box = { left: r.left, top: r.top, right: r.left + r.width, bottom: r.bottom };
  const view = { width: window.innerWidth, height: window.innerHeight };
  const key = [target.left, target.top, target.right, target.bottom, view.width, view.height, note?.offsetWidth ?? 0, note?.offsetHeight ?? 0].map(Math.round).join(",");
  const now = performance.now();
  // Measured again when the control moves, and every so often while it stays (the page may still be filling in).
  if (!placed || placed.key !== key || now - placed.at > 400) {
    const content = contentBoxes();
    const box = ringBox(target, ringInsets(target, content), view);
    let left = 0;
    let top = 0;
    let score = 0;
    if (note) {
      const best = placeNote(box, { width: note.offsetWidth, height: note.offsetHeight }, view, content);
      // Stays put unless the control moved or somewhere is clearly better now, so the note does not jitter.
      const size = { width: note.offsetWidth, height: note.offsetHeight };
      const here = placed && placed.key === key ? noteCost(box, size, content, placed.left, placed.top, 0) : Infinity;
      ({ left, top, score } = here - best.score < 200 && placed ? { left: placed.left, top: placed.top, score: here } : best);
    }
    placed = { key, at: now, left, top, score, ring: box };
  }
  const box = placed.ring;
  Object.assign(ring.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.right - box.left}px`, height: `${box.bottom - box.top}px` });
  if (note) Object.assign(note.style, { left: `${placed.left}px`, top: `${placed.top}px` });
  frame = requestAnimationFrame(place);
}

/** `again` finds the control anew when the screen replaces it, so a re-drawn page keeps its ring. */
export function showSpotlight(el: HTMLElement, text: string | null, again?: () => HTMLElement | null) {
  clearSpotlight();
  tracked = el;
  el.setAttribute("data-demo-ringed", "");
  refind = again ?? null;
  // A line, not a band: it stands off the control into the gap around it and never paints over a neighbour's words.
  ring = layer("pointer-events-none fixed z-50 rounded-sm border-2 border-primary transition-all duration-200 motion-reduce:transition-none");
  ring.setAttribute("data-demo-spotlight", "");
  if (text) {
    note = layer("pointer-events-none fixed z-50 max-w-xs rounded-sm bg-ink px-3 py-2 text-sm text-surface shadow-raised");
    note.setAttribute("role", "status");
    note.setAttribute("data-demo-note", "");
    note.removeAttribute("aria-hidden");
    note.textContent = text;
  }
  place();
}

export function clearSpotlight() {
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  tracked?.removeAttribute("data-demo-ringed");
  ring?.remove();
  note?.remove();
  ring = null;
  note = null;
  tracked = null;
  refind = null;
  lostSince = 0;
  placed = null;
}

/** Glide the soft cursor to a point; resolves when it has arrived. */
export function moveCursor(x: number, y: number): Promise<void> {
  if (!cursor) {
    cursor = layer("pointer-events-none fixed z-50 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-primary/60 shadow-raised transition-all duration-500 ease-out motion-reduce:transition-none");
    Object.assign(cursor.style, { left: `${window.innerWidth / 2}px`, top: `${window.innerHeight / 2}px` });
  }
  const c = cursor;
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      Object.assign(c.style, { left: `${x}px`, top: `${y}px` });
      setTimeout(() => {
        c.classList.add("scale-75");
        setTimeout(() => {
          c.classList.remove("scale-75");
          resolve();
        }, 140);
      }, 520);
    });
  });
}
