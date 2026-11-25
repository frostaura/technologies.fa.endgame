import { currentAddress } from "@/lib/router";

/**
 * The address a signed-out visitor first asked for, kept while they sign in so they land there after,
 * not on the org chart. Only a console address is kept: never another site, never the sign-in page.
 */
const KEY = "endgame.return-to";

export function safeReturnTo(path: string | null | undefined): string | null {
  if (!path || !path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) return null;
  const bare = path.split(/[?#]/)[0] ?? "";
  if (bare === "/" || bare === "/sign-in" || bare.startsWith("/sign-in/")) return null;
  return path;
}

/** Called as the sign-in screen first draws, before the address is replaced with /sign-in. */
export function rememberReturnTo(): string | null {
  // The console's own address, which in the demo's hash mode is after the # (ARCH-009), not the page's path.
  const here = typeof window === "undefined" ? null : safeReturnTo(currentAddress());
  try {
    if (here) window.sessionStorage.setItem(KEY, here);
    return here ?? safeReturnTo(window.sessionStorage.getItem(KEY));
  } catch {
    return here;
  }
}

/** The address to go to now that the person is signed in, used once. */
export function takeReturnTo(fallback: string | null): string | null {
  try {
    const kept = safeReturnTo(window.sessionStorage.getItem(KEY));
    window.sessionStorage.removeItem(KEY);
    return kept ?? fallback;
  } catch {
    return fallback;
  }
}
