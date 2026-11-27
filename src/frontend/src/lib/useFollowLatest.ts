import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/** How close to the foot still counts as "at the latest": a line or so of slack. */
const NEAR_FOOT = 48;

/** Marks what arrives in a log as news (a reply, a card it started): only that can say "New reply". */
export const ARRIVAL = "data-arrival";

/**
 * A scrolling log that keeps the latest in view, as a conversation does. It opens at its foot —
 * also when it was hidden (a closed sheet) and is shown again — and follows what is added there:
 * a new message, a reply as it streams in. Someone who has scrolled up to read what was said
 * before is left where they are; `behind` then says something new arrived below — only something
 * marked with {@link ARRIVAL} and drawn below what they can see, never an earlier turn filling in as
 * it is scrolled to — and `toLatest` takes them to it (and follows again). Sending calls `toLatest`.
 *
 * A log that does not scroll (it is as tall as what it holds) is never moved.
 */
export function useFollowLatest(ref: RefObject<HTMLElement | null>): { behind: boolean; toLatest: () => void } {
  const [behind, setBehind] = useState(false);
  const following = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const atFoot = () => el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_FOOT;
    const toFoot = () => {
      el.scrollTop = el.scrollHeight;
    };
    let shownHeight = el.clientHeight;

    const onScroll = () => {
      // Hidden, a log reports no height: that is not the person scrolling away.
      if (el.clientHeight === 0) return;
      following.current = atFoot();
      if (following.current) setBehind(false);
    };
    /** Whether a change brought news, and drew it below the bottom of what can be seen. */
    const arrivedBelow = (records: MutationRecord[]) => {
      const foot = el.getBoundingClientRect().bottom;
      for (const r of records) {
        const nodes = r.type === "characterData" ? [r.target.parentElement] : [...r.addedNodes].map((n) => (n instanceof Element ? n : n.parentElement));
        for (const n of nodes) {
          if (!n) continue;
          const news = n.closest(`[${ARRIVAL}]`) ?? n.querySelector(`[${ARRIVAL}]`);
          if (news && news.getBoundingClientRect().bottom > foot + 1) return true;
        }
      }
      return false;
    };
    const onContent = (records: MutationRecord[]) => {
      if (el.clientHeight === 0) return;
      if (following.current) toFoot();
      else if (!atFoot() && arrivedBelow(records)) setBehind(true);
    };
    const onResize = () => {
      const h = el.clientHeight;
      // Shown again (a sheet opened): the latest, every time.
      if (shownHeight === 0 && h > 0) {
        following.current = true;
        setBehind(false);
        toFoot();
      } else if (following.current) toFoot();
      shownHeight = h;
    };

    toFoot();
    el.addEventListener("scroll", onScroll, { passive: true });
    const mutations = new MutationObserver(onContent);
    mutations.observe(el, { childList: true, subtree: true, characterData: true });
    const sizes = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(onResize);
    sizes?.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      mutations.disconnect();
      sizes?.disconnect();
    };
  }, [ref]);

  const toLatest = useCallback(() => {
    following.current = true;
    setBehind(false);
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [ref]);

  return { behind, toLatest };
}
