import { noteCost, placeNote, ringBox, ringInsets, type Box } from "./placement";

/**
 * The academy's marks on the page: a spotlight ring around a control, with an optional note, and
 * a soft cursor that moves to what a step acts on. Both are drawn above the console, never take a
 * click (`pointer-events: none`), and follow the control as the page scrolls or reflows.
 */

let ring: HTMLDivElement | null = null;
let note: HTMLDivElement | null = null;
let arrow: HTMLSpanElement | null = null;
let cursor: HTMLDivElement | null = null;
let cursorFade = 0;
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
/** Still drawn: in the page, or in an Edge page's frame that is itself still in the page (a removed frame's nodes stay "connected" to its own document). */
function onPage(el: Element): boolean {
  if (!el.isConnected) return false;
  const win = el.ownerDocument.defaultView;
  if (!win) return false;
  return win === window || (win.frameElement !== null && onPage(win.frameElement));
}

let placed: { key: string; at: number; left: number; top: number; score: number; ring: Box } | null = null;

/** What stands over a page as a whole: a dialog, a sheet, the device's own prompt. */
const MODAL = "[role=dialog], [role=alertdialog], dialog[open], [aria-modal=true], [data-demo-device]";

/**
 * Whether something modal now covers the control — a dialog opened over it after it was ringed. The
 * ring and note then step aside, so they never draw over the dialog's own words.
 */
function covered(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  const doc = el.ownerDocument;
  const x = Math.min(Math.max(r.left + r.width / 2, 0), (doc.defaultView?.innerWidth ?? 1) - 1);
  const y = Math.min(Math.max(r.top + r.height / 2, 0), (doc.defaultView?.innerHeight ?? 1) - 1);
  const hit = doc.elementFromPoint(x, y);
  if (!hit || hit === el || el.contains(hit) || hit.contains(el)) return false;
  const over = hit.closest(MODAL);
  return !!over && !over.contains(el);
}

/**
 * The note's pointer: a small notch on the side that faces the ring, aimed at the ring's middle, so
 * the note reads as being about that control. None when the note had to sit over the ring.
 */
function aim(box: Box, left: number, top: number) {
  if (!note || !arrow) return;
  const w = note.offsetWidth;
  const h = note.offsetHeight;
  const cx = (box.left + box.right) / 2;
  const cy = (box.top + box.bottom) / 2;
  const clamp = (v: number, max: number) => Math.max(12, Math.min(v, max - 12));
  let side: "top" | "bottom" | "left" | "right" | null = null;
  if (top >= box.bottom - 1) side = "top";
  else if (top + h <= box.top + 1) side = "bottom";
  else if (left >= box.right - 1) side = "left";
  else if (left + w <= box.left + 1) side = "right";
  arrow.hidden = side === null;
  if (!side) return;
  const at = side === "top" || side === "bottom" ? { left: `${clamp(cx - left, w) - 5}px`, top: side === "top" ? "-5px" : `${h - 5}px` } : { top: `${clamp(cy - top, h) - 5}px`, left: side === "left" ? "-5px" : `${w - 5}px` };
  Object.assign(arrow.style, at);
}

function place() {
  frame = 0;
  if (!tracked || !ring) return;
  if (!onPage(tracked)) {
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
  // A dialog opened over the control: the ring and note wait, hidden, until it closes.
  const hidden = covered(tracked);
  ring.hidden = hidden;
  if (note) note.hidden = hidden;
  if (hidden) {
    frame = requestAnimationFrame(place);
    return;
  }
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
  // The light outline is drawn outside the element's own box: the box is set one pixel inside the ring's.
  Object.assign(ring.style, { left: `${box.left + 1}px`, top: `${box.top + 1}px`, width: `${box.right - box.left - 2}px`, height: `${box.bottom - box.top - 2}px` });
  if (note) {
    Object.assign(note.style, { left: `${placed.left}px`, top: `${placed.top}px` });
    aim(box, placed.left, placed.top);
  }
  frame = requestAnimationFrame(place);
}

/** `again` finds the control anew when the screen replaces it, so a re-drawn page keeps its ring. */
export function showSpotlight(el: HTMLElement, text: string | null, again?: () => HTMLElement | null) {
  clearSpotlight();
  tracked = el;
  el.setAttribute("data-demo-ringed", "");
  refind = again ?? null;
  // A line, not a band: it stands off the control into the gap around it and never paints over a neighbour's words.
  ring = layer("pointer-events-none fixed z-50 rounded-sm border-2 border-primary outline outline-1 outline-surface transition-all duration-200 motion-reduce:transition-none");
  ring.setAttribute("data-demo-spotlight", "");
  if (text) {
    note = layer("pointer-events-none fixed z-50 max-w-xs rounded-sm bg-ink px-3 py-2 text-sm text-surface shadow-raised");
    note.setAttribute("role", "status");
    note.setAttribute("data-demo-note", "");
    note.removeAttribute("aria-hidden");
    const words = document.createElement("span");
    words.className = "relative";
    words.textContent = text;
    arrow = document.createElement("span");
    arrow.setAttribute("aria-hidden", "true");
    arrow.className = "absolute size-2.5 rotate-45 bg-ink";
    arrow.hidden = true;
    note.append(arrow, words);
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
  arrow = null;
  tracked = null;
  refind = null;
  lostSince = 0;
  placed = null;
}

/** A small pointer, its tip on the point it names: an arrow outlined in white so it reads on any ground. */
const POINTER = '<svg viewBox="0 0 16 20" width="16" height="20" aria-hidden="true"><path d="M1.5 1.5v15l4-3.6 2.6 5.6 2.6-1.2-2.6-5.5h5.4z" fill="currentColor" stroke="white" stroke-width="1.5" stroke-linejoin="round"/></svg>';

/**
 * Glide the soft cursor to a point; resolves when it has arrived and pressed. It fades once the
 * press is done, so it never stays behind over what the press opened.
 */
export function moveCursor(x: number, y: number): Promise<void> {
  if (!cursor) {
    cursor = layer("pointer-events-none fixed z-50 text-ink opacity-0 drop-shadow transition-all duration-500 ease-out motion-reduce:transition-none");
    cursor.innerHTML = POINTER;
    cursor.setAttribute("data-demo-cursor", "");
    Object.assign(cursor.style, { left: `${window.innerWidth / 2}px`, top: `${window.innerHeight / 2}px` });
  }
  const c = cursor;
  window.clearTimeout(cursorFade);
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      c.classList.remove("opacity-0");
      Object.assign(c.style, { left: `${x}px`, top: `${y}px` });
      setTimeout(() => {
        c.classList.add("scale-90");
        setTimeout(() => {
          c.classList.remove("scale-90");
          cursorFade = window.setTimeout(() => c.classList.add("opacity-0"), 450);
          resolve();
        }, 140);
      }, 520);
    });
  });
}
