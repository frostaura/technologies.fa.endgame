# UC-101 — Sign in with a passkey

| Field | Value |
| --- | --- |
| **ID** | UC-101 |
| **Title** | Register a passkey, sign in and out, and see who I am |
| **Primary actor** | Owner · Admin · Builder · Viewer |
| **Scope** | Control plane (`/api/auth/*`, `/api/me`), reached through Edge |
| **Cascade level** | None to sign in; `GET /api/me` lists every role held, at every level |
| **Status** | Built |

## Goal

A person proves who they are with a passkey — no password ever exists — and gets a cookie session.
Endgame is invite-only: only the very first person, or someone holding an invitation code, can
register.

## Preconditions

- **First run:** no organisation and nobody registered. The first person needs no invitation.
- **Otherwise:** an Owner or Admin granted the person a role (`POST /api/members`), which returned a
  one-time invitation code (valid 7 days, stored only as a SHA-256 hash).
- A signed-in person may add another passkey to their own account.

## Main flow

1. The browser asks `POST /api/auth/passkey/register/options` with `{ email, displayName, invitationCode? }`.
   The answer is `{ publicKey: PublicKeyCredentialCreationOptionsJSON }`; what the registration is for
   is kept in a data-protected, five-minute cookie the browser cannot read or change.
2. The authenticator creates the key; the browser posts `{ credential }` to `.../register/complete`.
   Identity verifies the attestation (challenge, origin, relying party); the control plane checks the
   attestation's user is the one the cookie names, stores the passkey and signs the person in.
3. The answer is `Me`: `{ user: { id, displayName, email }, organisation: { id, slug, name } | null, isOperator, passkeys, memberships[] }`.
4. On first run `organisation` is null; the person names it with `POST /api/organisations { name, slug }`
   and becomes its Owner.
5. Later sign-ins: `POST .../login/options {}` → `{ publicKey }`, then `.../login/complete { credential }` → `Me`.
6. `POST /api/auth/logout` ends the session (204).

## Alternate and failure flows

- **A1 — not invited.** Registration options answer 403 `forbidden`; nothing is created.
- **A2 — wrong or used invitation code.** 403; the code is cleared once a passkey is registered.
- **A3 — the credential was made for another origin.** 400 `passkey_rejected`; no session.
- **A4 — an unknown passkey.** 401 `passkey_rejected`.
- **A5 — signed out.** `GET /api/me` is 401 `unauthenticated` as problem details — distinguishable from any other failure.
- **A6 — development.** `GET /api/auth/options` → `{ passkey: true, developmentSignIn }`. Only when the
  environment is Development **and** `ENDGAME_DEV_LOGIN=true` is `POST /api/auth/development` mapped; it
  signs in `ENDGAME_DEV_USER_EMAIL` (default `dev@frostaura.net`) or the e-mail in the body. In any other
  configuration the route does not exist (404) and is absent from the OpenAPI document.

## Postconditions

- A passkey is stored (Identity schema v3, table `user_passkeys`); a 14-day sliding cookie `endgame.session`.
- Nothing is charged.

## Rules this use case must honour

- No self-serve sign-up (spec, *Who it is for*). Development sign-in provably absent in production (assumption 12).
- Optional hardening: `Passkeys:ServerDomain` and `Passkeys:AllowedOrigins` pin the relying party and origins.

## Acceptance

- The first person registers, names the organisation, signs out and back in with the same passkey.
- A stranger cannot register; an invited person can, once, and lands with exactly the granted role.
- A credential for another origin, or an unknown key, never yields a session.
- The development sign-in is 404 in Production (with or without the flag), Staging, and Development without the flag.

Tests: [`TEST-101`](../testing/TEST-101-control-plane.md) — `SignInTests`, `DevelopmentSignInTests`.

## Links

- Spec *Shared services* (identity), *Who it is for* · ARCH-004 *Session* · Microsoft Learn, *Enable WebAuthn passkeys* (ASP.NET Core 10).

## In the console

- *Your account* (`/account`) shows the passkey count with **Add another passkey** (registration while signed in
  adds to the caller's own account), every role held in every organisation, and the organisation switcher.
- After signing in the console opens the address first asked for (a console path only, used once).
