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
