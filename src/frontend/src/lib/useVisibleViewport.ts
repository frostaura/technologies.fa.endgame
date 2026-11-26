import { useEffect } from "react";

/**
 * Keeps `--visible-height` and `--visible-top` on the root equal to the part of the screen not under
 * the on-screen keyboard, while a sheet is open. Where `visualViewport` is missing, the variables are
 * left unset and the sheet takes the dynamic viewport height.
 */
export function useVisibleViewport(on: boolean) {
  useEffect(() => {
    if (!on || typeof window === "undefined" || !window.visualViewport) return;
    const vv = window.visualViewport;
    const root = document.documentElement;
    const update = () => {
      root.style.setProperty("--visible-height", `${Math.round(vv.height)}px`);
      root.style.setProperty("--visible-top", `${Math.round(vv.offsetTop)}px`);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      root.style.removeProperty("--visible-height");
      root.style.removeProperty("--visible-top");
    };
  }, [on]);
}
