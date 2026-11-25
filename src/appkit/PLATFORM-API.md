# The platform API the app kit calls

The contract between an app built on the kit and the rest of Endgame: what Dock injects, what Edge
does to every request, and the HTTP endpoints the control plane serves to apps. ARCH-004 names
these services; this file fixes their exact shape. The dev platform fake
(`dev/Endgame.AppKit.DevPlatform`) implements every endpoint here and is the executable reference;
change both together.

## 1. Environment Dock injects into every app container

| Variable | Required | Value |
| --- | --- | --- |
| `ENDGAME_DATABASE` | yes | Npgsql connection string for the app's own database and role (opaque names, capped connections — ARCH-005). |
| `ENDGAME_PLATFORM_URL` | yes | Base URL of the platform API as the app reaches it, e.g. `http://control-plane:8080`. |
| `ENDGAME_APP_TOKEN` | yes | The app's bearer token for the platform API. Also the HMAC key for platform → app callbacks (§4). Rotated by restarting the app. |
| `ENDGAME_EGRESS_PROXY` | yes in production | Forward proxy URL, e.g. `http://egress:8080`. The kit sends every platform call through it and sets it as the process-wide default proxy, so the app's own `HttpClient`s go out the same way. Plain-HTTP absolute-form and `CONNECT` must both be supported. |
| `ENDGAME_APP_ID` | no | The app's id; the telemetry `service.name` and the OpenAPI title. |
| `ENDGAME_TELEMETRY_EXPORT` | no | `false` turns OTLP export off. |
| `ENDGAME_PREVIEW` | no | `true` on the factory evaluator's preview (Dock sets it): no OTLP export and no custom events, so the app's telemetry is its people's use only. |
| `ASPNETCORE_HTTP_PORTS` | set by the image | `8080`. |

Missing required variables stop the app at start with one message naming all of them. Workspace
containers running an app's tests additionally need **`ENDGAME_TEST_DATABASE`**: a PostgreSQL
connection string to a server where the tests may `CREATE DATABASE` and `DROP DATABASE … WITH (FORCE)`.

## 2. What the app serves (its side of the contract)

All paths are relative to the app's address; the app listens on `8080`.

| Path | Who calls it | What |
| --- | --- | --- |
| `GET health` | Edge, Dock | `200 {"status":"healthy","database":"reachable"}` or `503`. Not traced. |
| `GET openapi/v1.json` | Control plane (MCP derivation) | OpenAPI 3.1. Every operation has an `operationId` (lowerCamelCase, unique, ≤ 64) and a `description`; the app refuses to start otherwise. `servers[0]` is the address it was fetched at. |
| `GET api/me` | The front end | `{"user": EndgameUser \| null}` (operation `getCurrentUser`). |
| `api/*` | Browsers, MCP | The app's own API. Errors are `application/problem+json`. |
| `POST _platform/schedules/{name}` | Control plane only | Schedule runs, signed (§4). **Edge must never route `_platform/*` from the public side.** |
| `POST hooks/{name}` | Outside callers | Declared webhooks (§3.6). Edge lets these through even when the app is private. |
| anything else, `GET` | Browsers | The front end, with `<base href>` rewritten to the forwarded prefix. |

## 3. Control plane endpoints for apps — `/platform/v1/*`

Every request carries `Authorization: Bearer <ENDGAME_APP_TOKEN>`; the control plane derives the
app (and its organisation, cascade and budgets) from the token. Bodies are JSON, camelCase.
Errors are problem details with a stable `code` extension; the kit branches on `code` only.
`401` with any code means the app token was refused.

### 3.1 Identity — `POST /platform/v1/identity/resolve`

```json
→ { "session": "<value of X-Endgame-Session>" }
← 200 { "user": { "id": "usr_…", "email": "…", "displayName": "…", "kind": "member" | "endUser",
                  "role": "owner" | "admin" | "builder" | "viewer" | null },
        "expiresAt": "2026-11-24T20:00:00Z" }
← 401 { "code": "session_invalid" }   expired, unknown, or not a session for this app
```

`role` is the member's effective role on this app (null for end users). The kit caches a
resolution for at most 30 s and never past `expiresAt`.

### 3.2 Models — `POST /platform/v1/models/chat`

```json
→ { "messages": [{ "role": "system" | "user" | "assistant", "content": "…" }],
    "taskType": "chat" | "classify" | "summarise" | "extract", "maxTokens": 512, "temperature": 0.2 }
← 200 { "content": "…", "model": "…", "usage": { "inputTokens": 10, "outputTokens": 20 }, "credits": 0.001 }
← 402 { "code": "budget_exhausted" }      terminal; the kit never retries (EndgameBudgetExhaustedException)
← 402 { "code": "overdraft_limit" }       the organisation is at its overdraft limit; terminal until it is
                                           topped up, never retried (EndgameOverdraftLimitException)
← 422 { "code": "ceiling_unreachable" }   no model for the task type fits the price ceiling
```

Non-streaming. The control plane reserves credits before the call and settles from the reply
(ARCH-004 `/internal/model/chat`), charging the app's cascade.

### 3.3 Secrets — `GET /platform/v1/secrets/{name}`

`name` is `UPPER_SNAKE_CASE`. `200 { "name", "value", "scope": "org/division/project" }` — the
level that set it, resolved through the cascade. `404 { "code": "secret_not_found" }` with a detail
that names the levels searched.

### 3.4 Email — `POST /platform/v1/email`

```json
→ { "to": ["a@b.c"], "subject": "…", "text": "…", "html": "…" (optional), "replyTo": "…" (optional) }
← 202 { "id": "eml_…" }
← 400 { "code": "invalid_request" }
```

From the factory's preview (its own token), the answer is the same 202, and the message is held: kept for the evaluator,
never delivered.

### 3.5 Schedules — `PUT /platform/v1/schedules`

Replaces the app's whole set; sent on every start (an empty list removes them all).

```json
→ { "schedules": [{ "name": "nightly-digest", "cron": "0 3 * * *", "timeZone": "UTC",
                    "path": "_platform/schedules/nightly-digest" }] }
← 200 (echo)
```

Five-field cron; `name` is a lowercase slug. The platform then calls `POST <app>/<path>` on the
cron, signed (§4), body `{ "scheduledFor": "<ISO time>" }`. `204` = done; anything else = failed.

### 3.6 Webhooks — `PUT /platform/v1/webhooks`

```json
→ { "webhooks": [{ "name": "court-sensor", "path": "hooks/court-sensor" }] }
← 200 (echo)
```

Tells Edge to admit unauthenticated `POST`s to `<app address>/hooks/<name>` even on a private app.
Verification (HMAC-SHA256 of the body, or a shared token, against a vault secret) is done in the
app by the kit; the platform does not see the secret's use.

### 3.7 Custom events — `POST /platform/v1/telemetry/events`

```json
→ { "events": [{ "name": "note.created", "at": "…", "properties": { "length": 12 }, "userId": "usr_…" }] }
← 202
```

Batched (≤ 100 per request, about once a second). Names are lowercase dot-separated words.

### 3.8 OpenTelemetry — `POST /platform/v1/otlp/v1/{traces|metrics|logs}`

OTLP/HTTP protobuf, bearer app token. Traces (ASP.NET Core, HttpClient, Npgsql), metrics every
15 s, logs with formatted messages and scopes. The intake attributes them by the token.

## 4. Platform → app callbacks

`X-Endgame-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(key = ENDGAME_APP_TOKEN, message = "<t>." + raw body)>`.
The app refuses a missing, wrong or > 5-minute-old signature with `401`. `Endgame.AppKit.CallbackSignature`
produces and checks exactly this; the control plane may reference it.

## 5. What Edge does to every request into an app

An app has two addresses, both four segments deep (ARCH-004): the path form
`https://<platform host>/<org>/<division>/<project>/<app>/` and the organisation subdomain
`https://<org>.<organisation domain>/<division>/<project>/<app>/` (or that subdomain's root, when the
control plane gives an app the whole of it).

1. Either form without its trailing slash (`/<org>/<division>/<project>/<app>`, or
   `/<division>/<project>/<app>` on the subdomain) → `308` to the same address with `/`. Strip the
   prefix; set `X-Forwarded-Prefix` to it, no trailing slash: `/<org>/<division>/<project>/<app>` on
   the path form, `/<division>/<project>/<app>` on the subdomain. An app at a subdomain's root gets no
   prefix header.
2. Set `X-Forwarded-Host`, `X-Forwarded-Proto`, `X-Forwarded-For`; remove any the client sent.
3. Remove every client-sent `X-Endgame-*` header. If the visitor has a session valid for this app,
   set `X-Endgame-Session` to an **app-scoped** token — never the browser's own cookie value, so
   an app cannot replay it against the console. Strip every platform cookie (`endgame.*`: the console
   session and every `endgame.app.*` app session) from `Cookie`.
4. Serve `<app address>/_endgame/auth/{sign-in|sign-up|sign-out|handoff}?returnTo=<path or address>`
   itself (the organisation's identity pages, driving the control plane's `/api/app-auth/{appId}/*`);
   accept only a `returnTo` inside one of the app's two addresses. On the subdomain, sign-in and
   sign-up move to the path form on the platform's host and come back through `handoff`, which sets
   the subdomain's own app-session cookie.
5. Never route `<app address>/_platform/*` from the public side. Platform callbacks reach the app
   from Edge's control listener, signed (§4).
6. A request to a private app without a session is redirected to step 4's sign-in — except
   `POST hooks/<name>` for a name the app declared (§3.6) and `health` polled from Edge's own listener.

The React Router home of an app is written without its trailing slash during client navigation;
rule 1 makes a reload there land correctly.

## 6. Building and starting an app (Dock)

- **Template:** `make -C src/appkit vendor` packs the kit into `src/appkit/template/vendor/`
  (`nuget/*.nupkg`, `npm/endgame-appkit-<version>.tgz`). A new app's repository is a copy of
  `src/appkit/template/` *including* `vendor/`, which the app repository commits.
- **Image:** in the build container (needs the .NET 10 SDK, Node ≥ 22.12 and npm; network for
  nuget.org and npm on a cold cache): `dotnet publish api/App.Api.csproj /t:PublishContainer
  -p:ContainerRepository=app-<id> -p:ContainerImageTag=<commit> -p:ContainerArchiveOutputPath=<file>.tar.gz`.
  The publish runs `npm ci` + `npm run build` itself. RID defaults to `linux-<build host arch>`;
  pass `-r linux-x64|linux-arm64` to choose. Result: framework-dependent, ReadyToRun,
  `noble-chiseled`, user `app`, `DOTNET_EnableDiagnostics=0`.
- **Run:** read-only root, `--tmpfs /tmp:rw,noexec,nosuid`, all capabilities dropped,
  `no-new-privileges`, memory and pid limits, on the app's internal network. Migrations run at
  start; first start against an empty database takes the schema to the latest migration.
