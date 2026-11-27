import { chooseSubject, intersect, keepInside, markerAt, ringBox, ringInsets, shownFraction, type Box, type Rung } from "./placement";

/**
 * The academy's marks on the page: a spotlight ring around what a step is about, with the step's
 * number on its corner, and a soft cursor that moves to what a step acts on. Both are drawn above
 * the console, never take a click (`pointer-events: none`), and follow what they mark as the page
 * scrolls or reflows. The ring is cut where the scroll area it sits in ends (under a sticky header,
 * above a phone's bottom bar), and is not drawn at all while what it marks is out of view.
 */

let ring: HTMLDivElement | null = null;
let marker: HTMLDivElement | null = null;
let cursor: HTMLDivElement | null = null;
let cursorFade = 0;
let tracked: HTMLElement | null = null;
/** What the ring goes round: the tracked element, or the card it sits in — decided once, as it is shown. */
let subjectEl: HTMLElement | null = null;
let asRegion = false;
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
export function pageRect(el: Element): { left: number; top: number; width: number; height: number; bottom: number; right: number } {
  const r = el.getBoundingClientRect();
  const { dx, dy } = offsetOf(el);
  return { left: r.left + dx, top: r.top + dy, width: r.width, height: r.height, bottom: r.bottom + dy, right: r.right + dx };
}

/** How far an element's own document is moved on the demo's page: by each Edge page frame it is drawn in. */
function offsetOf(el: Element): { dx: number; dy: number } {
  let dx = 0;
  let dy = 0;
  // Out to the demo's own page, and no further: embedded, the demo is itself in the academy's frame.
  let win = el.ownerDocument.defaultView;
  while (win && win !== window && win.frameElement) {
    const f = win.frameElement;
    const r = f.getBoundingClientRect();
    dx += r.left + f.clientLeft;
    dy += r.top + f.clientTop;
    win = f.ownerDocument.defaultView;
  }
  return { dx, dy };
}

const boxOf = (el: Element): Box => {
  const r = pageRect(el);
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
};

/**
 * What the page shows inside the viewport: each run of words and each control, image or chart, in
 * the demo's own page coordinates (an Edge page's frame included). The ring stands clear of them.
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

const CARDISH = "li, article, fieldset, dialog, tr, [role=group], [role=region], [role=listitem], [role=row], [role=article], [role=dialog], [data-card]";
const transparent = (c: string) => c === "transparent" || /rgba\([^)]*,\s*0\)$/.test(c);

/** Drawn as a card: a border, a shadow, a ground of its own — or a list item or a group the page names. */
function isCard(el: HTMLElement): boolean {
  if (el.matches(CARDISH)) return true;
  const s = (el.ownerDocument.defaultView ?? window).getComputedStyle(el);
  if (s.boxShadow && s.boxShadow !== "none") return true;
  const bordered = ["Top", "Right", "Bottom", "Left"].filter((side) => parseFloat(s.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0 && !transparent(s.getPropertyValue(`border-${side.toLowerCase()}-color`))).length;
  if (bordered >= 3) return true;
  const ground = s.backgroundColor;
  if (!transparent(ground) && el.parentElement) {
    const parent = (el.ownerDocument.defaultView ?? window).getComputedStyle(el.parentElement).backgroundColor;
    if (ground !== parent && s.borderRadius !== "0px") return true;
  }
  return false;
}

/** Things a learner presses or types into: ringed as themselves, not as the card around them. */
const CONTROL = "button, a[href], input, select, textarea, summary, [role=button], [role=link], [role=tab], [role=switch], [role=checkbox], [role=radio], [role=menuitem]";

/**
 * The cards this lesson has rung so far, each with what it named in it: a later step about another
 * thing inside one of them (its Approve button, after the plan above it; the third figure of a
 * balance already rung) rings that thing, not the same card again.
 */
let rung: { subject: HTMLElement; named: HTMLElement }[] = [];

/** What the ring surrounds for this element (see `chooseSubject`); a region is ringed as it is. */
export function subjectOf(el: HTMLElement, region = false): HTMLElement {
  if (region) return el;
  const named = boxOf(el);
  const isControl = el.matches(CONTROL) && (named.right - named.left) >= 24 && (named.bottom - named.top) >= 16;
  if (isControl) return el;
  const avoid = rung.filter((r) => r.named !== el && r.subject !== el && r.subject.isConnected && r.subject.contains(el)).map((r) => r.subject);
  const rungs: { el: HTMLElement; rung: Rung }[] = [];
  for (let p = el.parentElement; p && p !== el.ownerDocument.body && p !== el.ownerDocument.documentElement && !avoid.includes(p); p = p.parentElement) {
    rungs.push({ el: p, rung: { box: boxOf(p), card: isCard(p) } });
  }
  const chosen = chooseSubject(named, rungs.map((r) => r.rung), { width: window.innerWidth, height: window.innerHeight });
  return rungs.find((r) => r.rung.box === chosen)?.el ?? el;
}

/** Fixed or sticky bars that stand over the page (the console's header, a phone's bottom bar), unless they hold the element. */
function bars(el: Element): { top: number; bottom: number } {
  let top = 0;
  let bottom = window.innerHeight;
  const header = document.querySelector<HTMLElement>("body > div header, header");
  const nav = document.querySelector<HTMLElement>("[data-bottom-nav]");
  if (header && !header.contains(el) && /sticky|fixed/.test(getComputedStyle(header).position)) top = Math.max(top, header.getBoundingClientRect().bottom);
  if (nav && !nav.contains(el)) {
    const r = nav.getBoundingClientRect();
    if (r.height > 0) bottom = Math.min(bottom, r.top);
  }
  return { top, bottom };
}

/**
 * The part of the page an element can be seen in: the viewport, less the bars standing over it, cut
 * by every box on its way up that scrolls or clips its contents (a pane, a sheet, an Edge page's frame).
 */
export function clipFor(el: Element): Box {
  const b = bars(el);
  let clip: Box = { left: 0, top: b.top, right: window.innerWidth, bottom: b.bottom };
  let node: Element | null = el.parentElement;
  while (node) {
    const doc = node.ownerDocument;
    if (node === doc.documentElement || node === doc.body) {
      const frameEl: Element | null = doc.defaultView && doc.defaultView !== window ? doc.defaultView.frameElement : null;
      if (!frameEl) break;
      clip = intersect(clip, boxOf(frameEl));
      node = frameEl.parentElement;
      continue;
    }
    const s = (doc.defaultView ?? window).getComputedStyle(node);
    if (/(auto|scroll|hidden|clip)/.test(`${s.overflowX} ${s.overflowY}`)) {
      const r = boxOf(node);
      const html = node as HTMLElement;
      // The box's inside: its scrollbars and borders are not where the page is drawn.
      clip = intersect(clip, { left: r.left + html.clientLeft, top: r.top + html.clientTop, right: r.left + html.clientLeft + html.clientWidth, bottom: r.top + html.clientTop + html.clientHeight });
    }
    node = node.parentElement;
  }
  return clip;
}

let refind: (() => HTMLElement | null) | null = null;
let lostSince = 0;
let number: number | null = null;
/** Still drawn: in the page, or in an Edge page's frame that is itself still in the page (a removed frame's nodes stay "connected" to its own document). */
function onPage(el: Element): boolean {
  if (!el.isConnected) return false;
  const win = el.ownerDocument.defaultView;
  if (!win) return false;
  return win === window || (win.frameElement !== null && onPage(win.frameElement));
}

let placed: { key: string; at: number; ring: Box } | null = null;
/** What the ring showed last, for the academy's checks (`endgameDemo.ring()`). */
let last: { shown: boolean; ring: Box | null; visible: Box | null; clip: Box | null; named: Box | null } = { shown: false, ring: null, visible: null, clip: null, named: null };

/** What stands over a page as a whole: a dialog, a sheet, the device's own prompt. */
const MODAL = "[role=dialog], [role=alertdialog], dialog[open], [aria-modal=true], [data-demo-device]";

/**
 * Whether something modal now covers the control — a dialog opened over it after it was ringed. The
 * ring steps aside, so it never draws over the dialog's own words.
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

function hide() {
  if (ring) ring.hidden = true;
  if (marker) marker.hidden = true;
  last = { ...last, shown: false, visible: null };
}

function place() {
  frame = 0;
  if (!tracked || !ring) return;
  if (!onPage(tracked)) {
    // The screen drew it again (a refresh, a retry): the ring follows the new one, and waits a while for it.
    const again = refind?.();
    if (again) {
      tracked.removeAttribute("data-demo-ringed");
      tracked = again;
      tracked.setAttribute("data-demo-ringed", "");
      subjectEl = subjectOf(again, asRegion);
      placed = null;
    } else {
      lostSince ||= performance.now();
      if (performance.now() - lostSince > 10_000) {
        clearSpotlight();
        return;
      }
      hide();
      frame = requestAnimationFrame(place);
      return;
    }
  }
  lostSince = 0;
  // A dialog opened over the control: the ring waits, hidden, until it closes.
  if (covered(tracked)) {
    hide();
    frame = requestAnimationFrame(place);
    return;
  }
  const named = boxOf(tracked);
  const clip = clipFor(tracked);
  const view = { width: window.innerWidth, height: window.innerHeight };
  const key = [named.left, named.top, named.right, named.bottom, clip.top, clip.bottom, view.width, view.height].map(Math.round).join(",");
  const now = performance.now();
  // Measured again when the control moves, and every so often while it stays (the page may still be filling in).
  if (!placed || placed.key !== key || now - placed.at > 400) {
    const subject = boxOf(subjectEl && onPage(subjectEl) ? subjectEl : tracked);
    const around = ringBox(subject, ringInsets(subject, contentBoxes()));
    // A subject that shows whole is ringed whole: where its room around would run past the edge of
    // its scroll area (a card the width of a phone, a pane's last row), the ring is drawn just
    // inside that edge. One cut by the edge is left cut, and so shown for what it is.
    const whole = subject.left >= clip.left - 2 && subject.right <= clip.right + 2 && subject.top >= clip.top - 2 && subject.bottom <= clip.bottom + 2;
    // A subject bigger than its scroll area (a whole app's page, a long list) is ringed where it shows.
    const bigger = subject.bottom - subject.top > clip.bottom - clip.top;
    placed = { key, at: now, ring: whole || bigger ? keepInside(bigger ? intersect(around, clip) : around, clip) : keepInside(around, { left: 0, top: -Infinity, right: view.width, bottom: Infinity }) };
  }
  const box = placed.ring;
  // Out of view (scrolled past, under a bar): no ring at all until what it marks is back.
  // Taller than its scroll area (a long list, a whole app's page), it is in view when it fills most of it.
  const filling = (Math.min(named.bottom, clip.bottom) - Math.max(named.top, clip.top)) / Math.max(1, clip.bottom - clip.top);
  const seen = Math.max(shownFraction(named, clip), named.bottom - named.top > clip.bottom - clip.top ? filling : 0);
  if (seen < (asRegion ? 0.25 : 0.9)) {
    hide();
    last = { shown: false, ring: box, visible: null, clip, named };
    frame = requestAnimationFrame(place);
    return;
  }
  const visible = intersect(box, clip);
  ring.hidden = false;
  // The light outline is drawn outside the element's own box: the box is set one pixel inside the ring's.
  Object.assign(ring.style, {
    left: `${box.left + 1}px`,
    top: `${box.top + 1}px`,
    width: `${box.right - box.left - 2}px`,
    height: `${box.bottom - box.top - 2}px`,
    // Cut where its scroll area ends: never drawn over a sticky header, a bar, or the next pane.
    clipPath: `inset(${Math.max(0, visible.top - box.top - 1)}px ${Math.max(0, box.right - visible.right - 1)}px ${Math.max(0, box.bottom - visible.bottom - 1)}px ${Math.max(0, visible.left - box.left - 1)}px)`,
  });
  if (marker) {
    marker.hidden = false;
    const at = markerAt(visible, clip);
    Object.assign(marker.style, { left: `${at.left}px`, top: `${at.top}px` });
  }
  last = { shown: true, ring: box, visible, clip, named };
  frame = requestAnimationFrame(place);
}

/**
 * Ring an element: `marker` is the step's number, drawn on the ring's corner (the academy's caption
 * under its frame starts with the same number); `region` rings a region as it is, where a step
 * shows a state rather than a control. `again` finds the element anew when the screen replaces it.
 */
export function showSpotlight(el: HTMLElement, options: { marker?: number | null; region?: boolean } = {}, again?: () => HTMLElement | null) {
  clearSpotlight();
  tracked = el;
  asRegion = !!options.region;
  number = options.marker ?? null;
  el.setAttribute("data-demo-ringed", "");
  refind = again ?? null;
  subjectEl = subjectOf(el, asRegion);
  rung = [...rung.filter((r) => r.subject.isConnected), { subject: subjectEl, named: el }];
  ring = layer("pointer-events-none fixed z-50 rounded-md border-2 border-primary outline outline-1 outline-surface motion-safe:transition-[left,top,width,height] motion-safe:duration-200");
  ring.setAttribute("data-demo-spotlight", "");
  ring.hidden = true;
  if (number !== null) {
    marker = layer("pointer-events-none fixed z-50 flex size-6 items-center justify-center rounded-full bg-primary text-xs font-semibold tabular-nums text-primary-ink shadow-raised outline outline-2 outline-surface");
    marker.setAttribute("data-demo-marker", "");
    marker.textContent = String(number);
    marker.hidden = true;
  }
  place();
}

export function clearSpotlight() {
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  tracked?.removeAttribute("data-demo-ringed");
  ring?.remove();
  marker?.remove();
  ring = null;
  marker = null;
  tracked = null;
  subjectEl = null;
  refind = null;
  lostSince = 0;
  placed = null;
  number = null;
  last = { shown: false, ring: null, visible: null, clip: null, named: null };
}

/** A new screen or a new lesson: what the step before rang no longer matters. */
export function forgetSteps() {
  rung = [];
}

/** What the ring shows now, in the demo's page coordinates: for the academy's checks of every step. */
export function ringState() {
  return { ...last, marker: number, region: asRegion, tracking: tracked !== null };
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
