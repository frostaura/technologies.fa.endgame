# UC-109 — An app uses the platform's services

| Field | Value |
| --- | --- |
| **ID** | UC-109 |
| **Title** | A running app calls identity, models, secrets, e-mail, schedules, webhooks and telemetry through the platform API |
| **Primary actor** | An app built on the kit (its token); Dock (issues it); Admin (sets secrets) |
| **Scope** | Control plane `/platform/v1/*`, `/internal/apps/{id}/token`, `/api/secrets`; the scheduler, the e-mail dispatcher |
| **Cascade level** | Secrets, budgets, `app_models.monthly_credits` and the overdraft resolve from the app upwards |
| **Status** | Built (control-plane side) |

The contract is [`src/appkit/PLATFORM-API.md`](../../src/appkit/PLATFORM-API.md); the additions are in
[`ARCH-004`](../architecture/ARCH-004-service-contracts.md).

## Main flow

1. Dock asks `POST /internal/apps/{id}/token` before starting the app and injects the `egt_…` token as
   `ENDGAME_APP_TOKEN`. The control plane keeps only its hash; every call is attributed to the app and its
   whole path.
2. On start the kit declares `PUT schedules` and `PUT webhooks`. Webhook names appear in the app's routing
   entry (`hooks`); schedules get their next run in their own time zone.
3. A visitor's request arrives with `X-Endgame-Session`; the kit resolves it with `identity/resolve`.
4. The app calls `models/chat` (task type `chat`, `classify`, `summarise` or `extract`, each fixed to an
   app-safe route), `secrets/{name}`, `email`, and sends `telemetry/events` and OTLP traces, metrics and logs.
5. The scheduler leases due schedules and calls the app back, signed, through Edge's control listener.
   The dispatcher delivers queued e-mail through SMTP.
6. The app page shows visits, requests, errors, typical and slow response times and health from that
   telemetry; the org chart shows visits today.

## Alternate and failure flows

- **A1 — token.** Missing, unknown or superseded (after the grace period): 401 `app_token_invalid`. A call that
  came through Edge's public side: 404.
- **A2 — money.** Over a budget or the app's own model allowance: 402 `budget_exhausted`; past the overdraft
  limit: 402 `overdraft_limit`. Both terminal; nothing reaches the provider.
- **A3 — secret.** No level sets it: 404 `secret_not_found`, naming the levels searched.
- **A4 — e-mail without SMTP.** Accepted (202) and kept in the outbox; nothing is sent until `Smtp__Host` and
  `Smtp__From` are set.
- **A5 — schedule fails.** The app's status (or the error) is recorded on the schedule; the next occurrence
  still runs. A run missed while the platform was down runs once.
- **A6 — invalid declarations or telemetry.** 400 `invalid_request`; an unreadable OTLP body is 400, an unknown
  signal 404, an oversized one 413.

## Rules this use case must honour

- Credits are reserved before a model call, in the transaction that admits it (rule 8).
- Secrets are never returned by any console read and never logged; sealed at rest.
- Default telemetry is operational and belongs to the app's organisation (rule 2).

## Acceptance

- The kit's own request shapes, sent to the real control plane, get the answers PLATFORM-API specifies; the
  callback signature verifies with the kit's algorithm.

Tests: [`TEST-102`](../testing/TEST-102-platform-api.md) — `PlatformApiTests`, `PlatformUnitTests`.
