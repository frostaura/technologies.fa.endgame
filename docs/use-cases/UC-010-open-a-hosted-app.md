# UC-010 — Open a hosted app

| Field | Value |
| --- | --- |
| **ID** | UC-010 |
| **Title** | Open an app at either of its addresses, waking it if it sleeps |
| **Primary actor** | App end user · organisation member (any role) · anyone, for a public app |
| **Scope** | Edge (routing, access, wake, sleep) · Dock (start, stop, crash watch) · Control plane (routing table, access check) |
| **Cascade level** | App — its access setting and sleep setting are resolved down the cascade by the control plane |
| **Status** | Built |

## Goal

A visitor opens `endgame.frostaura.net/<org>/<division>/<project>/<app>/` or
`<org>.frostaura.net/<division>/<project>/<app>/` (or the subdomain's root, when the control plane
gives an app the whole subdomain) and
gets the app — at once if it is awake, in well under a second if it was asleep — or a plain page
saying why not.

## Preconditions

- The app has a running version (Dock started it once: network, database and role exist).
- The control plane lists it in `GET /internal/routes` with its addresses, access, sleep setting
  and availability.

## Main flow

1. The visitor requests a path-form address without its trailing slash; Edge answers `308` to the
   same address with the slash, so the page's relative URLs resolve under it.
2. Edge matches the route — a subdomain-form host outranks everything, a path-form prefix outranks
   the platform's own `/api` and console routes. `<app>/_platform/*` is never routed (404);
   `<app>/_endgame/auth/{sign-in,sign-up,sign-out}` is answered by Edge itself, with a `returnTo`
   held inside the app's address.
3. Edge checks availability: a paused app gets its holding page; an unpublished one says it is not
   ready yet. Neither is woken.
4. For a private or shared app — and for a public one when the visitor carries a cookie — Edge asks
   the control plane (`POST /internal/access/check`) whether this session may open it; the answer,
   with an app-scoped session token, is reused briefly for the same cookie. `POST <app>/hooks/<name>`
   skips the check (the app kit verifies the signature). Until the endpoint exists, Edge falls back
   to `GET /api/me`: a role on the app's scope or above admits.
5. Edge counts the request in. If the app sleeps, Edge asks Dock to wake it — one wake shared by
   every concurrent request — then polls the app's `/health` on the app's own network.
6. Edge strips the prefix, sets `X-Forwarded-Prefix`, `-Host`, `-Proto` and `-For` itself (anything
   the visitor sent is dropped, and every client-sent `X-Endgame-*`), removes the platform's session
   cookie, sets `X-Endgame-Session` to the app-scoped token — never the browser's cookie — and
   forwards. A woken request carries `X-Endgame-Wake-Ms`.
7. When the app has been idle for its own sleep setting with nothing in flight, Edge asks Dock to
   stop it, keeping the container for the next wake.

## Alternate and failure flows

- **A1 — Crash.** Dock sees the app's process exit unasked and reports it to Edge and the control
  plane at once. Every waiting and later request gets "This app has stopped for a moment" (503)
  until the back-off passes; then the next request wakes it again.
- **A2 — No room.** Dock refuses the wake because awake apps' measured memory would exceed the
  budget; the visitor gets "could not start just now".
- **A3 — Slow start.** The app is not healthy within the wake timeout: "taking longer than usual".
- **A4 — Sign-in.** No session: `GET` is redirected to `<app>/_endgame/auth/sign-in?returnTo=…`
  (or the address the control plane names), which sends the visitor on to the platform's sign-in
  page; other methods get `401` with that address in `Location`.
- **A5 — Not shared with them.** A signed-in person without access: "You don't have access" (403).
- **A6 — The control plane cannot answer the access check.** Private and shared apps are closed
  (503), never opened.

## Postconditions

- The request reached the app or the visitor saw a page that names no infrastructure.
- An app that slept is awake and counted; one idle past its setting is asleep.

## Rules this use case must honour

- Only Dock touches Docker (rule 5): Edge wakes and sleeps through Dock's API.
- Normal mode never names infrastructure (rule 12): every unavailable page is plain language.
- `/internal/*` is never routed from outside (ARCH-004); Edge's control listener is unreachable
  from app networks (ARCH-005).
- Path-form apps share one browser origin, so the platform's cookie never reaches an app.

## Acceptance

- Both address shapes serve the same image, with the right base, prefix and host.
- Twenty concurrent requests to a sleeping app cause exactly one wake.
- A crash turns the next request into the unavailable page within two seconds.
- Ten measured wakes: median and worst first-byte times recorded in `TEST-010`.

## Links

- Spec: *Addresses and hosting*, *Layer 3 — the platform* · ARCH-004 · ARCH-005 · TEST-010
