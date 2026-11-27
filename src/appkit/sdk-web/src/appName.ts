/**
 * The app's name, as the platform names it: the name it has in its organisation, which the console, the platform's
 * sign-in page and its e-mails show too. The server writes it into every page it serves
 * (`<meta name="endgame-app-name">`, PLATFORM-API.md §5); this reads it, so the header and the tab title say exactly what
 * the sign-in page said — and follow a rename with no rebuild. `fallback` is used where no platform serves the page: tests,
 * and `vite` on a developer's machine.
 */
export function appName(fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const named = document.querySelector('meta[name="endgame-app-name"]')?.getAttribute("content")?.trim();
  return named ? named : fallback;
}
