/**
 * The router's base, from the page's `<base>`: `""` at the root of a subdomain,
 * `"/acme/labs/demo"` under a path. Pass it to `<BrowserRouter basename={routerBasename()}>`;
 * then `<Link to="/notes">` and `navigate("/notes")` stay inside the app at either address.
 */
export function routerBasename(): string {
  return new URL(document.baseURI).pathname.replace(/\/$/, "");
}

/** The current location inside the app, as a path the platform may return to. */
function here(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function authUrl(page: "sign-in" | "sign-up", returnTo: string): string {
  const url = new URL(`_endgame/auth/${page}`, document.baseURI);
  url.searchParams.set("returnTo", returnTo);
  return url.toString();
}

/** The platform's sign-in page for this app, returning here (or to `returnTo`) afterwards. */
export function signInUrl(returnTo: string = here()): string {
  return authUrl("sign-in", returnTo);
}

/** The platform's sign-up page, for someone registering to use this app. */
export function signUpUrl(returnTo: string = here()): string {
  return authUrl("sign-up", returnTo);
}

/** Signs the person out and returns them to the app's home. */
export function signOutUrl(): string {
  return new URL("_endgame/auth/sign-out", document.baseURI).toString();
}
