# UC-111 — Hosting is metered, the overdraft holds, and God mode is audited

| Field | Value |
| --- | --- |
| **ID** | UC-111 |
| **Title** | Dock reports hosting usage as credits; work stops and apps pause at the overdraft limit; operators' entries are logged for the Owner |
| **Primary actor** | Dock; a FrostAura operator; the organisation's Owner |
| **Scope** | Control plane `/internal/usage/hosting`, `/internal/routes`, `/api/credits`, `/api/cascade`, `/api/operator/organisations`, `/api/audit/operator-access`; the sweep |
| **Cascade level** | `overdraft_limit` (operator, organisation) → `overdraft_own_limit` (Owner, organisation) → `overdraft_limit` below; `monthly_credits` budgets |
| **Status** | Built — Dock and Edge report usage; the routing table pauses and Edge holds |

## Main flow

1. Dock posts per-app usage samples (`awakeSeconds`, mean `memoryBytes`, the database's `storageBytes`)
   and Edge posts the `requests` it forwarded, each every `UsageReportSeconds` with sample ids naming
   the reporter, the app and the period.
   Each becomes one `hosting` ledger entry: US$ at the `Hosting` rates, converted by the one margin factor.
   The same `sampleId` is charged once.
2. Hosting counts as spend everywhere: the balance, every monthly budget, the credits view (`month.hosting`)
   and the app's cost and expected running cost.
3. An organisation may run below zero down to its effective overdraft. Past it, the routing table marks its
   apps `paused` (`pausedReason: overdraft_limit`) and model calls are refused with 402 `overdraft_limit`.
   A spent budget above an app pauses it too (`budget_exhausted`). A top-up restores everything at once.
4. An operator — only an address in `ENDGAME_OPERATORS` — lists every organisation and enters one as Admin;
   each entry is written to `operator_actions` as `organisation.entered`, which the Owner reads at
   `/api/audit/operator-access`, with every other operator action. **One visit, one entry:** an explicit
   `POST …/{slug}/enter` always writes one and starts a visit; a read inside the organisation
   (`GET /api/tree?organisation=`, or any scoped read an operator makes there) writes one only when that
   operator's last entry or read in that organisation is more than `Operators:EntryLogWindowMinutes` (10)
   ago — the visit slides on with each read, so a polling org chart is one entry. Concurrent first reads
   write one row (an advisory lock on organisation and operator). The last-seen time is kept per process;
   after a restart the log is the record, so the rule only errs toward logging. Every change the operator
   makes there as Admin is one more entry (`admin.<EndpointName>`, titled plainly); a refused change is none.
   In the console every screen works on the entered organisation, which is named in the God-mode band.
5. The sweep releases reservations that lapsed with their lease and requeues runs whose lease lapsed.
6. God mode's screens (operators only, never by access token): `GET /api/operator/organisations` — each
   organisation's balance, standing (`in-credit`, `overdrawn`, `at-limit`), overdraft, apps, last
   activity and open top-up requests; `POST /api/operator/organisations/{slug}/enter` (logged);
   `PUT …/{slug}/overdraft { credits }` (logged); `GET /api/operator/top-ups`; the top-up requests; the prices.
7. Provisioning screens, then hands over: `POST /api/organisations { name, slug, ownerEmail, description }`
   puts what the organisation does to a model against the four red lines (a platform cost in `platform_costs`,
   charged to no organisation), refuses a breach (422 `red_line`, naming the line and why), and writes the
   screening (who, how, the reason, the result) to the new organisation's operator log. It returns the Owner's
   one-time code once and e-mails it when a mail server is configured (`invitationEmailed`).

## Alternate and failure flows

- **A1 — limits.** The organisation's own limit may be tighter than FrostAura's, never deeper (400); only the
  Owner sets it, only an operator sets FrostAura's (403).
- **A2 — bad samples.** Longer than 24 hours, negative, or awake beyond the period: 400; an unknown app: 404.
- **A3 — no model to screen with.** Provisioning is refused (503 `screening_unavailable`) unless the operator
  sends their own decision with a written reason (`screening { decision, reason }`), which is logged as manual.
  A model's answer always outranks it.
- **A4 — an Owner asks for a top-up.** Every operator is told in their own feed (`topup.requested`, UC-119);
  answering it with a top-up closes it with the top-up's note and logs `topup_request.fulfilled`.

## Rules this use case must honour

- Overdraft carries no interest and no fees (rule 3): nothing in the ledger accrues with time.
- God-mode entry is never silent (rule 1), and neither is anything done there.
- No organisation may build a red-line product (rule 4): provisioning screens the organisation.

## Acceptance

- The balance past the limit equals top-ups less what was spent, before and after time and the sweep.

Tests: [`TEST-102`](../testing/TEST-102-platform-api.md) — `ControlPlaneDebtsTests`;
[`TEST-010`](../testing/TEST-010-hosting.md) — `UsageLedgerTests`, `EdgePipelineTests` (requests);
[`TEST-090`](../testing/TEST-090-stack-acceptance.md) — usage as credits, the paused page and the top-up;
[`TEST-101`](../testing/TEST-101-control-plane.md) — `BreadthTests` (God mode's screens, hand-over), `ScreensAndRolesTests` (screening, the per-action log, top-up requests).
