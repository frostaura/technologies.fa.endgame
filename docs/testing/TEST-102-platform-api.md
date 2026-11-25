# TEST-102 — Platform API and the control plane's second pass

| Field | Value |
| --- | --- |
| **ID** | TEST-102 |
| **Covers** | UC-109 · UC-110 · UC-111 · UC-107 (access) · ARCH-004 (`/platform/v1`, `/api/app-auth`, `/internal/access/*`, `/internal/apps/{id}/token`, `/internal/usage/hosting`) |
| **Status** | Current |

## What must be true, and where it is proved

| Statement | Test |
| --- | --- |
| The kit's own requests get PLATFORM-API's answers from the real control plane | `PlatformApiTests` — identity, models (OpenRouter faked), secrets, e-mail (SMTP sink), schedules, webhooks, telemetry (protobuf and JSON OTLP) |
| A schedule callback verifies with the kit's `CallbackSignature` algorithm | `PlatformApiTests.Schedules_are_declared_called_back_signed...` (captured where Edge's control listener would be) |
| App tokens are stored hashed, rotate, and the platform API is not reachable through Edge | `PlatformApiTests.The_app_token_is_required...` |
| An app's model calls are reserved, attributed to its path and held to its own cap | `PlatformApiTests.Models_go_through_the_same_gateway...` |
| Secrets are sealed per row and never read back by the console | `PlatformApiTests.Secrets_cascade...`, `PlatformUnitTests.The_vault_seals...` |
| Telemetry is null until measured, then real | `PlatformApiTests.Telemetry_is_stored_per_app...` |
| Private, shared and public are enforced; end users are one app's | `AppAccessTests` (real passkeys through Identity's handler) |
| `returnTo` cannot redirect elsewhere; hand-offs are one-time, one-app, short-lived | `AppAccessTests.A_return_address_outside...` (ten cases × three endpoints), `A_session_on_the_path_host_is_handed_off...` |
| Only a person makes an app public | `AppAccessTests.Only_a_person_can_make_an_app_public...` |
| Operators are an explicit list; entries are logged and only the Owner reads them | `ControlPlaneDebtsTests.Operators_come_from_the_explicit_list...` |
| One margin factor; a margin below cost stops the host | `ControlPlaneDebtsTests.The_margin_is_one_factor...` |
| Peer addresses do not follow the environment name | `ControlPlaneDebtsTests.Peer_addresses_are_explicit...` |
| The sweep releases lapsed reservations and requeues lapsed runs | `ControlPlaneDebtsTests.The_sweep_releases...` |
| Hosting is metered once per sample and budgets count it | `ControlPlaneDebtsTests.Hosting_is_metered...` |
| At the overdraft limit work stops and apps pause; a top-up restores; nothing accrues | `ControlPlaneDebtsTests.At_the_overdraft_limit...` |
| The platform roles hold `CONNECT` themselves | `ControlPlaneDebtsTests.The_platform_roles_hold_connect...` |
| Cron, time zones and daylight saving | `PlatformUnitTests.Cron_*` |
| A hostile or mistaken dashboard query is refused before it runs | `TelemetrySqlGuardTests.A_hostile_or_mistaken_query_is_refused` (47 rows: writes, other tables, the catalog, `pg_sleep`, `set_config`, comments, quoting, locks, `INTO`, CTE tricks, casts) and `An_ordinary_dashboard_question_is_allowed` (10 rows) |
| Run without the guard, a query still reads one app only | `AskTests.Without_the_guard…` (RLS pins the app on the tables under the views; other tables refused by privilege; `set_config` refused; read-only; timeout; row limit) |
| A question is answered through the gateway, charged to the app; a refused query gets one uncharged repair | `AskTests.A_question_becomes…`, `A_refused_query_gets_one_repair…` |
| The model is told the views' real columns and types, read from the database catalog; there is no `id` and it is told so; every hint names a real view | `AskTests.The_prompt_lists_every_view_and_column_the_database_has_and_no_other` (checked against `information_schema` read as the superuser, and against the system message actually sent), `Every_hint_names_a_view_that_exists_and_every_view_has_one`, `A_hint_for_a_view_the_database_does_not_have_fails_the_prompt` |
| "Visits" asked about are the visits the app's page counts | `AskTests.Visits_in_the_views_are_the_visits_the_app_page_counts` (page GETs against API calls, files, a POST, a callback and a health check; `ask.requests.visit` equals `telemetry.visitsToday`) |
| A database error goes back to the model with the failing query for one repair, not charged | `AskTests.A_database_error_goes_back_to_the_model_for_one_uncharged_repair` (`count(id)` → the repair call carries `The database said: column "id" does not exist` → `count(*)` answers; ledger: two charged settlements, one not charged) |
| A repair that still fails is `422 ask_unanswerable` in plain words, the query and the database's message apart under `technical` | `AskTests.A_repair_that_still_fails_says_so_in_plain_words_with_the_technical_detail_apart` (title and detail name no query, column or database; no third call; ledger: one charged, one not) |
| The model may decline a question the views cannot answer | `AskTests.The_model_may_decline_a_question_the_views_cannot_answer` (its plain reason is the detail; one call, charged) |
| The dashboard re-runs saved questions; a Viewer reads, cannot ask | `AskTests.Saved_questions_rerun_on_read…` |
| A saved question that no longer runs says so in plain words, the database's message apart | `AskTests.A_saved_question_that_no_longer_runs_says_so_plainly_with_the_database_message_apart` |
| Urgent notifications go out through the outbox when mail is configured | `BreadthTests.The_owner_is_told…` (`email_messages.app_id` null) |

## Fixtures

- `SmtpSink` — an in-test SMTP server on a free loopback port; the real `SmtpEmailSender` delivers to it.
  Nothing is sent anywhere else: the shared fixture sets `Smtp:Host` empty.
- `OtlpWriter` — writes OTLP/HTTP protobuf export requests field for field.
- `ControlPlaneApp` — now also sets `ENDGAME_OPERATORS`, a test vault key, and switches the scheduler, the
  e-mail dispatcher and Edge notifications off; tests drive `Scheduler.RunDueOnceAsync`,
  `EmailDispatcher.DispatchOnceAsync` and `LeaseSweep.SweepOnceAsync` directly.

## Commands

`make test` (the whole backend and console suites), or one class:
`MSBuildEnableWorkloadResolver=false dotnet test src/backend/Endgame.Tests/Endgame.Tests.csproj --filter FullyQualifiedName~PlatformApiTests`.

## Not covered

Edge redeeming a hand-off and forwarding a schedule callback (owed by Edge); a real mail server; OTLP
from the kit's own exporter over the egress proxy (the bytes are written by `OtlpWriter`); the app
kit's SDK tests pointed at this control plane (they run against the dev platform fake).
