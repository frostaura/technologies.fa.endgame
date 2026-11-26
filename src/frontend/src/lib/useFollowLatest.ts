import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/** How close to the foot still counts as "at the latest": a line or so of slack. */
const NEAR_FOOT = 48;

/**
 * A scrolling log that keeps the latest in view, as a conversation does. It opens at its foot —
 * also when it was hidden (a closed sheet) and is shown again — and follows what is added there:
 * a new message, a reply as it streams in. Someone who has scrolled up to read what was said
 * before is left where they are; `behind` then says something new arrived below, and `toLatest`
 * takes them to it (and follows again). Sending a message calls `toLatest` too.
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
    let contentHeight = el.scrollHeight;

    const onScroll = () => {
      // Hidden, a log reports no height: that is not the person scrolling away.
      if (el.clientHeight === 0) return;
      following.current = atFoot();
      if (following.current) setBehind(false);
    };
    const onContent = () => {
      const grew = el.scrollHeight > contentHeight + 1;
      contentHeight = el.scrollHeight;
      if (el.clientHeight === 0) return;
      if (following.current) toFoot();
      else if (grew && !atFoot()) setBehind(true);
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
