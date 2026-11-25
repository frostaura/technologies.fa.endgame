// Endgame's outage page — a Cloudflare Worker routed in front of the console host and every
// organisation subdomain (ARCH-007). It forwards each request to the origin unchanged and returns
// the origin's answer, except when the origin cannot be reached: then a visitor gets a plain,
// branded "temporarily unavailable" page instead of a Cloudflare or browser error.
//
// Plain JavaScript, no build step: Endgame.Ops deploys this file as written. Tested under Node
// with a stubbed fetch (outage-worker.test.mjs).

// What counts as "the origin is down": the tunnel's own errors and Cloudflare's origin errors.
// 502 and 504 come from cloudflared when the Edge behind it is not answering; 520–527 and 530
// are Cloudflare's codes for an origin it could not reach (530 with error 1033 is a tunnel with no
// connector). 500, 501 and 503 are passed through: Endgame's Edge and its apps send those
// deliberately, with pages and bodies of their own (a paused app's holding page is a 503).
const ORIGIN_DOWN = new Set([502, 504, 520, 521, 522, 523, 524, 525, 526, 527, 530]);

export function isOriginDown(status) {
  return ORIGIN_DOWN.has(status);
}

// A browser navigating to a page gets the page; anything else (an API call, an asset) gets a
// short plain-text answer it can handle.
export function wantsPage(request) {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  const accept = request.headers.get("accept") || "";
  return accept.includes("text/html");
}

const TITLE = "Endgame is temporarily unavailable";
const MESSAGE =
  "It can't be reached right now. Nothing you have made has been lost — please try again in a few minutes.";

// The Endgame mark, inline so the page needs nothing from the origin it is standing in for.
const MARK =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="48" height="48" role="img" aria-label="Endgame">' +
  '<rect width="64" height="64" rx="16" fill="#2F5BFF"/>' +
  '<path d="M21 17v30M21 17h24M21 32h18M21 47h12" fill="none" stroke="#FFFFFF" stroke-width="5.5" stroke-linecap="round"/>' +
  '<circle cx="45" cy="17" r="5" fill="#FFFFFF"/><circle cx="39" cy="32" r="5" fill="#FFFFFF"/><circle cx="33" cy="47" r="5" fill="#7DF0DC"/></svg>';

export function outagePage() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${TITLE}</title>
<style>
:root { --ink: #0b0b0c; --muted: #55565c; --paper: #ffffff; --accent: #2f5bff; }
@media (prefers-color-scheme: dark) { :root { --ink: #f4f4f6; --muted: #a6a7ae; --paper: #0b0b0c; } }
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body { display: flex; align-items: center; justify-content: center; padding: 24px;
  background: var(--paper); color: var(--ink);
  font: 16px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 32rem; }
h1 { font-size: 1.5rem; line-height: 1.25; margin: 24px 0 8px; font-weight: 600; }
p { margin: 0; color: var(--muted); }
</style>
</head>
<body>
<main>
${MARK}
<h1>${TITLE}</h1>
<p>${MESSAGE}</p>
</main>
</body>
</html>
`;
}

export function outageResponse(request) {
  const headers = { "cache-control": "no-store", "retry-after": "120", "x-endgame-outage": "1" };
  if (!wantsPage(request)) {
    return new Response(request.method === "HEAD" ? null : `${TITLE}. Please try again in a few minutes.\n`, {
      status: 503,
      headers: { ...headers, "content-type": "text/plain; charset=utf-8" },
    });
  }
  return new Response(request.method === "HEAD" ? null : outagePage(), {
    status: 503,
    headers: { ...headers, "content-type": "text/html; charset=utf-8" },
  });
}

// The whole Worker, with fetch passed in so it can be tested without a network.
export async function handle(request, fetchOrigin) {
  let response;
  try {
    response = await fetchOrigin(request);
  } catch {
    return outageResponse(request);
  }
  return isOriginDown(response.status) ? outageResponse(request) : response;
}

export default {
  async fetch(request) {
    return handle(request, (r) => fetch(r));
  },
};
