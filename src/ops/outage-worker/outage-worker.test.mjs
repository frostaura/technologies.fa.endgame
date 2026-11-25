// The outage Worker's logic under Node, with the origin replaced by a stub: `node --test src/ops/outage-worker/`.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker, { handle, isOriginDown, outagePage, wantsPage } from "./worker.js";

const page = (path = "/", init = {}) =>
  new Request(`https://acme.frostaura.net${path}`, { headers: { accept: "text/html,application/xhtml+xml" }, ...init });
const api = (path = "/apps/notes/api/notes") => new Request(`https://acme.frostaura.net${path}`, { headers: { accept: "application/json" } });
const origin = (status, body = "from the origin", headers = {}) => async () => new Response(body, { status, headers });

test("a healthy origin's answer passes through untouched", async () => {
  const response = await handle(page(), origin(200, "<h1>Notes</h1>", { "x-app": "notes" }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-app"), "notes");
  assert.equal(await response.text(), "<h1>Notes</h1>");
});

test("the origin sees the very request the visitor made", async () => {
  let seen;
  const request = new Request("https://endgame.frostaura.net/api/me?x=1", { method: "POST", body: "hi", headers: { cookie: "a=b" } });
  await handle(request, async (r) => {
    seen = r;
    return new Response("ok");
  });
  assert.equal(seen, request);
});

for (const status of [502, 504, 520, 521, 522, 523, 524, 525, 526, 527, 530]) {
  test(`a ${status} from the tunnel or Cloudflare becomes the outage page`, async () => {
    const response = await handle(page(), origin(status, "error code: 1033"));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("retry-after"), "120");
    const html = await response.text();
    assert.match(html, /<title>Endgame is temporarily unavailable<\/title>/);
    assert.match(html, /Nothing you have made has been lost/);
    assert.doesNotMatch(html, /1033|tunnel|server|container|cloudflare/i, "plain language: no infrastructure named (CLAUDE.md rule 12)");
  });
}

test("an origin that cannot be reached at all becomes the outage page", async () => {
  const response = await handle(page(), async () => {
    throw new TypeError("fetch failed");
  });
  assert.equal(response.status, 503);
  assert.match(await response.text(), /temporarily unavailable/);
});

for (const status of [500, 501, 503, 404, 403, 302]) {
  test(`a deliberate ${status} from Endgame or an app is passed through`, async () => {
    const response = await handle(page(), origin(status, "the app's own page"));
    assert.equal(response.status, status);
    assert.equal(await response.text(), "the app's own page");
  });
}

test("an API call during an outage gets a short plain-text 503, not a page", async () => {
  const response = await handle(api(), origin(530));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.match(await response.text(), /^Endgame is temporarily unavailable\./);
});

test("HEAD during an outage gets the status and no body", async () => {
  const response = await handle(page("/", { method: "HEAD" }), origin(502));
  assert.equal(response.status, 503);
  assert.equal(await response.text(), "");
});

test("only GET and HEAD navigations want a page", () => {
  assert.equal(wantsPage(page()), true);
  assert.equal(wantsPage(page("/", { method: "POST", body: "x" })), false);
  assert.equal(wantsPage(api()), false);
});

test("the classification of statuses", () => {
  assert.equal(isOriginDown(530), true);
  assert.equal(isOriginDown(503), false);
  assert.equal(isOriginDown(200), false);
});

test("the page is self-contained: no external resource, the mark inline", () => {
  const html = outagePage();
  assert.doesNotMatch(html, /<script|<link|src=|url\(/i);
  assert.match(html, /<svg[^>]+aria-label="Endgame"/);
});

test("the default export is a module Worker with a fetch handler", () => {
  assert.equal(typeof worker.fetch, "function");
});
