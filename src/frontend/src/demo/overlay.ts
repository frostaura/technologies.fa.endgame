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

function place() {
  frame = 0;
  if (!tracked || !ring) return;
  if (!tracked.isConnected) {
    clearSpotlight();
    return;
  }
  const r = pageRect(tracked);
  Object.assign(ring.style, { left: `${r.left - 6}px`, top: `${r.top - 6}px`, width: `${r.width + 12}px`, height: `${r.height + 12}px` });
  if (note) {
    const below = r.bottom + 12 + 80 < window.innerHeight;
    Object.assign(note.style, { left: `${Math.max(8, Math.min(r.left, window.innerWidth - 328))}px`, top: below ? `${r.bottom + 12}px` : `${Math.max(8, r.top - 12 - note.offsetHeight)}px` });
  }
  frame = requestAnimationFrame(place);
}

export function showSpotlight(el: HTMLElement, text: string | null) {
  clearSpotlight();
  tracked = el;
  ring = layer("pointer-events-none fixed z-50 rounded-sm ring-4 ring-primary ring-offset-2 ring-offset-surface shadow-raised transition-all duration-200 motion-reduce:transition-none");
  ring.setAttribute("data-demo-spotlight", "");
  if (text) {
    note = layer("pointer-events-none fixed z-50 max-w-xs rounded-sm bg-ink px-3 py-2 text-sm text-surface shadow-raised");
    note.setAttribute("role", "status");
    note.removeAttribute("aria-hidden");
    note.textContent = text;
  }
  place();
}

export function clearSpotlight() {
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  ring?.remove();
  note?.remove();
  ring = null;
  note = null;
  tracked = null;
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
