# UC-110 — Open an app: private, shared or public, and its end users

| Field | Value |
| --- | --- |
| **ID** | UC-110 |
| **Title** | Edge asks who may open an app; people register as end users of one app; sessions carry to the subdomain |
| **Primary actor** | A visitor (member, end user, stranger); Admin (access and sharing); Edge |
| **Scope** | Control plane `/internal/access/check`, `/internal/access/handoff`, `/api/app-auth/{appId}/*`, `/api/apps/{id}/shares`, `/api/apps/{id}/settings` |
| **Cascade level** | `access` resolves down the cascade (default `private`); roles resolve down the cascade |
| **Status** | Built (control-plane side); Edge's hand-off page owed |

## Main flow

1. Edge sends `POST /internal/access/check { appId, cookie, path }` for a request into an app.
2. The control plane reads the console session (`endgame.session`) and the app's own session
   (`endgame.app.<app id>`), then decides from the app's access setting, the visitor's role through the
   cascade (operators enter as Admin, logged), the app's shares and its end users:
   - **private** — members with a role on the app; others signed in are denied; nobody signed in is asked to sign in.
   - **shared** — those, plus end users whose address it is shared with.
   - **public** — everyone; a known visitor also gets a session token so the app knows them.
3. On `allow` it returns an app-scoped `sessionToken` (`egs_…`, 15 minutes), which Edge sets as
   `X-Endgame-Session` and the app resolves (UC-109).
4. An Admin shares an app (`POST /api/apps/{id}/shares { email }`) and passes on the one-time code; the
   person registers at the app's sign-up page with a passkey, the address and the code.
5. Signing in or up on the platform's host with a `returnTo` on the organisation subdomain returns a
   one-time hand-off link; Edge redeems it there (`POST /internal/access/handoff`) and sets that host's own cookie.

## Alternate and failure flows

- **A1 — sign-up refused.** Private apps take no end users; shared apps refuse an address without its code, a
  used code, or an address not shared. 403.
- **A2 — returnTo elsewhere.** Anything outside the app's two addresses — another host, another app, a
  credential-bearing or scheme-tricked URL — is 400 `invalid_return_to`.
- **A3 — unshared.** The person's sessions end at once; the next check asks them to sign in, and signing in is refused.
- **A4 — another app.** An end user's passkey never signs in at another app; at another public app the same
  browser is anonymous.
- **A5 — hand-off.** Used, older than a minute, or for another app: 410 `handoff_invalid`.
- **A6 — platform callbacks.** `path` under `_platform/` is always denied.

## Rules this use case must honour

- Going public is a human act (rule 10): `access: public` is refused to agents and services (403 `human_only`).
- An end user has no role in the organisation and never reaches the console or another app.

## Acceptance

- Every decision above, and the open-redirect cases, hold against the real control plane with real passkeys.

Tests: [`TEST-102`](../testing/TEST-102-platform-api.md) — `AppAccessTests`.
