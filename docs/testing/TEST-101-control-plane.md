# TEST-101 — Control plane test strategy

| Field | Value |
| --- | --- |
| **ID** | TEST-101 |
| **Covers** | UC-101 to UC-108 · ARCH-002 · ARCH-003 · ARCH-004 (control-plane side) |
| **Status** | Current |

## What must be true

The acceptance statements of UC-101 to UC-108. The ones with the most weight, and where each is proved:

| Statement | Test |
| --- | --- |
| N concurrent admissions against a budget that fits K admit exactly K | `DatabaseInvariantTests.Forty_concurrent_admissions...` (ledger, 40 → 13) and `ModelGatewayTests.Concurrent_calls...` (HTTP, 12 → 5, provider reached 5 times) |
| Two concurrent claimers of one task: exactly one wins | `RunsAndTasksTests.Two_concurrent_claimers...` (five rounds) |
| Sequence numbers are gapless per run | `RunsAndTasksTests.Sequence_numbers_are_gapless...` (25 concurrent two-event appends → 1..50) |
| The development sign-in is absent outside Development + flag | `DevelopmentSignInTests.Is_not_mapped_outside_development_with_the_flag` (Production ± flag, Staging, Development without flag; 404 and absent from OpenAPI) |
| Real passkeys sign people in | `SignInTests` (software ES256 authenticator, "none" attestation, through Identity's own verification) |
| Tenancy is enforced by the database | `DatabaseInvariantTests.Row_level_security...`, `A_row_cannot_point_into_another_organisations_tree` |
| The ledger and run log are append-only | `DatabaseInvariantTests.The_ledger_and_the_run_log_are_append_only...` (as `endgame_app` by grant; as the superuser by trigger) |
| Statuses are constrained in the database | `DatabaseInvariantTests.Statuses_and_slugs_are_constrained...` |
| The gateway follows ARCH-003 | `ModelGatewayTests` (ceiling, reasoning, clamp, routing, settlement, streaming, errors, budget, repair), `RoutingTableTests` |
| The OpenAPI document lists every public endpoint | `OpenApiContractTests` |
| The console's JSON shapes are met | `ConsoleContractTests` (every key in lane-console `types.ts`) |

## Tests

| Level | Where | What it proves |
| --- | --- | --- |
| Unit | `src/backend/Endgame.Tests/Domain/` | Slugs, statuses, scope paths, the cascade resolver, role resolution, the reservation formula, decision rules |
| Unit | `ControlPlane/RoutingTableTests.cs` | The shipped routing table validates; faults are caught; reservation is at the sent ceiling |
| Integration | `ControlPlane/*Tests.cs` with `WebApplicationFactory` | The real control plane on a freshly migrated database; only OpenRouter replaced |
| Live (opt-in) | `ControlPlane/LiveModelTests.cs` | Every routed model id exists on OpenRouter; one real call settles at or under its reservation |

**Fixtures** (`src/backend/Endgame.Tests/Fixtures/`):

- `PostgresServer` — a throwaway `postgres:16.16-alpine` container on a free loopback port, started with the
  docker CLI (so the Docker client library never loads into the test process), one database per test class.
  `ENDGAME_TEST_POSTGRES=<admin connection string>` uses a server you started instead. Never the compose stack's database.
- `FakeOpenRouter` — an in-test Kestrel server answering in OpenRouter's shapes: `usage.cost`, streams with the
  usage on the last chunk, an error inside a 200, a mid-stream error chunk, a 404 when no provider fits
  `max_price`, and `/api/v1/generation`. It keeps every request body for assertions and can hold calls in flight.
- `SoftwareAuthenticator` — an ES256 passkey producing WebAuthn registration and assertion responses (minimal CBOR).
- `ControlPlaneApp` — the host, with browser-like clients (cookies, `Origin`) and a service-token client.

Commands: `make test` (whole suite); iterate with
`MSBuildEnableWorkloadResolver=false dotnet test src/backend/Endgame.Tests/Endgame.Tests.csproj --filter "FullyQualifiedName~ModelGatewayTests"`.
Live: `ENDGAME_LIVE_MODEL_TESTS=1 OPENROUTER_API_KEY=… dotnet test … --filter FullyQualifiedName~LiveModelTests` (one call on the `classify` route, 32 output tokens).

## Fixture variation

Reasoned from each test's setup; the passkey-origin and development-sign-in rows are exercised by the suite itself, the others were not each re-run with the field changed.

| Test | The one field that, changed, makes it fail |
| --- | --- |
| Concurrent admission (ledger) | Budget `each × 13 + 0.01` → `each × 14 + 0.01`: 14 admitted, the assertion on 13 fails |
| Concurrent admission (HTTP) | Removing the gate lets each call settle before the next is decided, so more than 5 are admitted |
| Budget exhaustion | Budget `0.001` → `50`: the first call is admitted and the 402 assertion fails |
| Overdraft tightening | Division value `5` → `30`: refused as deeper than the inherited 20 |
| Takeover from a dead holder | Without the `run.finished` of the holder, the takeover is a 409 |
| Development sign-in | Each `InlineData` row is one changed field (environment or flag) of the passing configuration |
| Passkey origin | `originOverride` set: rejected; unset: accepted |

## Against the running system

Not done by this lane: the compose stack (`make up`) belongs to the shared `endgame` project and was not
touched. The production configuration needs `ENDGAME_SERVICE_TOKEN` and `OPENROUTER_API_KEY` on the
control-plane service before the internal API and the gateway answer (see the lane report).

## States covered

Loading and stale are the console's. On the API: success; empty when genuinely empty (first-run tree,
empty conversation, `estimates: null`); failed reads as problem details with a stable `code` (401, 403,
404, 409, 422, 402, 502, 503) — never an empty list.
