# TEST-101 — Control plane test strategy

| Field | Value |
| --- | --- |
| **ID** | TEST-101 |
| **Covers** | UC-101 to UC-120 · ARCH-002 · ARCH-003 · ARCH-004 (control-plane side) |
| **Status** | Current |

## What must be true

The acceptance statements of UC-101 to UC-115. The ones with the most weight, and where each is proved:

| Statement | Test |
| --- | --- |
| N concurrent admissions against a budget that fits K admit exactly K | `DatabaseInvariantTests.Forty_concurrent_admissions...` (ledger, 40 → 13) and `ModelGatewayTests.Concurrent_calls...` (HTTP, 12 → 5, provider reached 5 times) |
| Two concurrent claimers of one task: exactly one wins | `RunsAndTasksTests.Two_concurrent_claimers...` (five rounds) |
| Sequence numbers are gapless per run | `RunsAndTasksTests.Sequence_numbers_are_gapless...` (25 concurrent two-event appends → 1..50) |
| A NUL in any string or key of an event is `400 event_invalid` naming where, never a 500, and nothing is appended | `RunsAndTasksTests.A_nul_character_anywhere_in_an_event_is_refused…` |
| The evaluator's test-member session resolves at the app as a member with that role, the same person per persona, never the Owner, for that app only, and only with the service token | `PlatformApiTests.The_evaluator_gets_a_session_for_a_test_member…` |
| The research estimate is the measured starting figure, then the median of the organisation's own past research actuals, under its ceiling, with its basis said | `RunnerContractTests.The_research_estimate_starts_at_a_measured_figure_then_tracks_the_median…` |
| The development sign-in is absent outside Development + flag | `DevelopmentSignInTests.Is_not_mapped_outside_development_with_the_flag` (Production ± flag, Staging, Development without flag; 404 and absent from OpenAPI) |
| Real passkeys sign people in | `SignInTests` (software ES256 authenticator, "none" attestation, through Identity's own verification) |
| Tenancy is enforced by the database | `DatabaseInvariantTests.Row_level_security...`, `A_row_cannot_point_into_another_organisations_tree` |
| The ledger and run log are append-only | `DatabaseInvariantTests.The_ledger_and_the_run_log_are_append_only...` (as `endgame_app` by grant; as the superuser by trigger) |
| Statuses are constrained in the database | `DatabaseInvariantTests.Statuses_and_slugs_are_constrained...` |
| The gateway follows ARCH-003 | `ModelGatewayTests` (ceiling, reasoning, clamp, routing, settlement, streaming, errors, budget, repair), `RoutingTableTests` |
| The OpenAPI document lists every public endpoint | `OpenApiContractTests` |
| The console's JSON shapes are met | `ConsoleContractTests` (every key in lane-console `types.ts`) |
| The Runner's own client works against every endpoint it needs | `RunnerContractTests` (`ControlPlaneClient`, `GatewayModelClient` and the conversation's tools, in process): each building tier with `provider.order` and only supported parameters; placement 201 then 200; headroom; cost history in one organisation; estimate accuracy per employee and organisation; the conversation's reads and actions; auto-mode's decision; the red line; autonomy and rule sets parsed by the harness |
| No one builds over a breached red line | `RunnerContractTests.A_breached_red_line_cannot_be_overruled_by_anyone_a_person_included`, and the check constraint `ck_ideas_red_line` |
| The track record is derived, never counted | `WorkforceTests.The_track_record_is_derived_from_runs_their_logs_and_the_ledger` |
| Every organisation-scoped table forces row-level security | `WorkforceTests.Every_organisation_scoped_table_forces_row_level_security` (every table with `organisation_id`) |
| The memory change log is append-only | `WorkforceTests.Memory_is_written_after_a_task…` (a DELETE as the owner is refused) |
| Every public endpoint × every role × inside and outside scope | `AuthorizationMatrixTests` — every `/api` endpoint has a row (or an exemption with its reason) or the build fails; a role at or above the row's minimum is let through, one below is `403`, outside is `404`; operators' rows refuse every member, the Owner included |
| Every MCP tool is held to the same roles | `AuthorizationMatrixTests.Every_mcp_tool_is_held_to_the_same_roles…` (each tool × Admin, Builder, Viewer tokens, inside and outside; another organisation is `404`) |
| Access tokens are hashed, capped, never Owner, revocable, last use shown | `McpTests.Tokens_are_shown_once…` |
| The SDK's own MCP client lists and calls control-plane tools, under the console's rules | `McpTests.The_control_plane_tools_do_what_the_console_does…` (secrets never read back; `public` is `human_only`; an organisation's overdraft refused; another organisation not found) |
| A token's role caps its person's | `McpTests.A_viewers_token_reads_and_changes_nothing` |
| An app's own API is derived from its OpenAPI and called through Edge with a member session | `McpTests.An_apps_own_api_is_derived…` (fake Edge control listener) |
| Versions name their authors; a restore is a new commit, rebuilt, and a public app turns private; only the Owner exports | `VersionsAndExportTests` (fake Dock) |
| An app's running cost is its own measured use at today's prices: hand-computed sleep and always-on figures from Dock and Edge samples over 58 hours, a sample outside the 14-day window ignored, under 24 hours "not enough history", and a price change moving both | `FinalDefectsTests.The_running_cost_of_each_choice_comes_from_the_apps_own_measured_use_and_the_current_prices` |
| An app counts its registered end users, not the members who open it; the ontology shows identity for an app with only a member's session or only a share | `FinalDefectsTests.An_app_counts_its_registered_end_users…`, `…An_app_people_sign_in_to_depends_on_identity…` |
| The credits view lists the narrower overdraft limits: at the organisation every division, project and app limit with who set it; at a project the division's above it and the app's beneath it, not a sibling division's | `FinalDefectsTests.The_credits_view_lists_every_narrower_overdraft_limit_on_and_beneath_the_scope` |
| God mode logs one entry per visit: an explicit entry then the org chart's burst of reads is one row; eight concurrent first reads are one row; a visit slides on with each read and ends after the window | `FinalDefectsTests.Entering_an_organisation_and_then_reading_it_is_one_logged_entry`, `…Reads_with_no_entry_before_them_log_one_entry…`, `OperatorVisitsTests` |
| Reserved names, role changes, runs by employee, notifications, top-up requests, God mode, prices, suggestions | `BreadthTests` (fake ops service) |

## Tests

| Level | Where | What it proves |
| --- | --- | --- |
| Unit | `src/backend/Endgame.Tests/Domain/` | Slugs, statuses, scope paths, the cascade resolver, role resolution, the reservation formula, decision rules |
| Unit | `ControlPlane/RoutingTableTests.cs` | The shipped routing table validates; faults are caught; reservation is at the sent ceiling |
| Integration | `ControlPlane/*Tests.cs` with `WebApplicationFactory` | The real control plane on a freshly migrated database; only OpenRouter replaced |
| Integration | `ControlPlane/WorkforceTests.cs` | The standing security reviewer; hire proposals, auto-mode within budget, one proposal per need, edit/accept/decline, checkpoints; the derived track record; memory written, read per scope, reviewed and curated; reassign, release, rehire; contractors, their caps and promotion; idle flag and auto-release; the ontology |
| Integration | `ControlPlane/RunnerContractTests.cs` | Section A of the third pass through the Runner's real client classes |
| Integration | `ControlPlane/McpTests.cs`, `AuthorizationMatrixTests.cs`, `VersionsAndExportTests.cs`, `BreadthTests.cs` | The fourth pass: MCP and tokens, the roles everywhere, versions and export, the rest of the breadth |
| Live (opt-in) | `ControlPlane/LiveModelTests.cs` | Every routed model id exists on OpenRouter; one real call settles at or under its reservation |

**Fixtures** (`src/backend/Endgame.Tests/Fixtures/`):

- `PostgresServer` — a throwaway `postgres:16.16-alpine` container on a free loopback port, started with the
  docker CLI (so the Docker client library never loads into the test process), one database per test class.
  `ENDGAME_TEST_POSTGRES=<admin connection string>` uses a server you started instead. Never the compose stack's database.
- `FakeOpenRouter` — an in-test Kestrel server answering in OpenRouter's shapes: `usage.cost`, streams with the
  usage on the last chunk, an error inside a 200, a mid-stream error chunk, a 404 when no provider fits
  `max_price`, and `/api/v1/generation`. It keeps every request body for assertions and can hold calls in flight.
- `SoftwareAuthenticator` — an ES256 passkey producing WebAuthn registration and assertion responses (minimal CBOR).
- `ControlPlaneApp` — the host, with browser-like clients (cookies, `Origin`), a service-token client, a
  bearer client and the MCP SDK's own client (`McpAsync`) for access tokens. It sets `Services:Ops`
  empty (the built-in reserved names) and switches the notification sweep off; tests drive
  `NotificationSweep.RunOnceAsync`.
- `FakePeer` — an in-test Kestrel server each test maps routes on, standing in for Dock, the ops service
  or Edge's control listener, with every request kept.

Commands: `make test` (whole suite); iterate with
`MSBuildEnableWorkloadResolver=false dotnet test src/backend/Endgame.Tests/Endgame.Tests.csproj --filter "FullyQualifiedName~ModelGatewayTests"`.
Live: `ENDGAME_LIVE_MODEL_TESTS=1 OPENROUTER_API_KEY=… dotnet test … --filter FullyQualifiedName~LiveModelTests` (one call on the `classify` route, 32 output tokens).

## Fixture variation

Reasoned from each test's setup; the passkey-origin, development-sign-in, auto-hire, promotion, idle-release and red-line rows are exercised by the suite itself (both sides of each are asserted), the others were not each re-run with the field changed.

| Test | The one field that, changed, makes it fail |
| --- | --- |
| Concurrent admission (ledger) | Budget `each × 13 + 0.01` → `each × 14 + 0.01`: 14 admitted, the assertion on 13 fails |
| Concurrent admission (HTTP) | Removing the gate lets each call settle before the next is decided, so more than 5 are admitted |
| Budget exhaustion | Budget `0.001` → `50`: the first call is admitted and the 402 assertion fails |
| Overdraft tightening | Division value `5` → `30`: refused as deeper than the inherited 20 |
| Takeover from a dead holder | Without the `run.finished` of the holder, the takeover is a 409 |
| Development sign-in | Each `InlineData` row is one changed field (environment or flag) of the passing configuration |
| Passkey origin | `originOverride` set: rejected; unset: accepted |
| Auto-hire within budget | `expectedMonthlyCredits` 5 → 10 under a 3-credit division budget: the proposal waits instead of being hired |
| Promotion | Two contractors in the role instead of three: no proposal is raised |
| Idle release | The project's autonomy `auto` → `checkpoints`: the sweep releases no one and the flag waits in needsYou |
| Red line | `redLines.breached` true → false: the overrule is accepted |
| Authorisation matrix | Changing one endpoint's role (the dashboard read to Builder) and one tool's (`secrets_list` to Viewer) made both matrix tests fail with exactly those rows (run once, then reverted) |
| Notifications, once per episode | Without the sweep between the half-way sample and the one past the limit, `overdraft.half` is never raised (it was, before the test was ordered so) |

## Against the running system

Not done by this lane: the compose stack (`make up`) belongs to the shared `endgame` project and was not
touched. The production configuration needs `ENDGAME_SERVICE_TOKEN` and `OPENROUTER_API_KEY` on the
control-plane service before the internal API and the gateway answer (see the lane report).

## States covered

Loading and stale are the console's. On the API: success; empty when genuinely empty (first-run tree,
empty conversation, `estimates: null`); failed reads as problem details with a stable `code` (401, 403,
404, 409, 422, 402, 502, 503) — never an empty list.
