# UC-103 — Pay for work with credits, within caps

| Field | Value |
| --- | --- |
| **ID** | UC-103 |
| **Title** | Top up, cap spend at any level, and read balance, spend and accuracy |
| **Primary actor** | Owner · Admin (caps) · FrostAura operator (top-ups) · system (reservations) |
| **Scope** | Control plane (`/api/credits`, `/api/credits/top-ups`, `/api/cascade`, the ledger) |
| **Cascade level** | Organisation balance; `monthly_credits` caps at any node and per employee |
| **Status** | Built |

## Goal

Cost is predictable: every model call reserves its worst case before it is sent, under every cap on its
path, and the bill is the ledger, line by line.

## Preconditions

- A top-up exists (operators only: `POST /api/credits/top-ups { organisation, credits, note, idempotencyKey? }`,
  logged in `operator_actions` for the Owner to read).

## Main flow

1. An Admin sets caps: `PUT /api/cascade { scope, kind: "budget", key: "monthly_credits", value }` at any node;
   an employee carries its own `monthlyCreditLimit`.
2. Each model call is admitted under the organisation's advisory lock: the balance (plus the tightest
   overdraft on the chain) and every cap on the call's chain must cover the reservation; the reservation is
   inserted in the same transaction. Concurrent calls therefore admit exactly as many as fit.
3. The reply settles the reservation from its own `usage.cost` (converted at `Credits:CreditsPerUsd` times the
   one margin factor `Credits:Margin`; 1.0, the default, is no margin and stands until the founder sets one).
   Hosting is charged the same way from Dock's usage samples ([UC-111](UC-111-metering-overdraft-and-god-mode.md)). A run's open reservations are released when it finishes; a reservation lapses with its
   run's lease, and a sweep writes the release.
4. `GET /api/credits?scope=` → `{ scope, balance, month { spent, ai, hosting }, monthsLeftAtPace, budgets[] { scope, name, level, depth, spentCredits, capCredits, appId } (tree order), estimates | null, notCharged { credits, repairs }, overdraft { frostauraLimit, ownLimit, limits[] { scope, name, level, credits, setAt, setBy, setByName } }, topUps[], heldCredits, available }` — `limits` are the narrower overdraft limits set at a division, project or app that apply at the scope (on its chain above it) or are set beneath it, in tree order; `[]` when there are none.

5. An Owner asks for more: `POST /api/credits/top-up-requests { credits, note }`; it appears to operators
   (`GET /api/operator/top-up-requests`), who top up by hand naming it (`requestId`) or decline it. No
   payment is taken.
6. Tighter limits: `PUT /api/credits/overdraft { scope, credits }` — the organisation's own (Owner), or a
   narrower one for a division, project or app (Admin); never deeper than what applies above. The credits
   page lists the narrower limits already set (Owner and Admin): each part's name and level, its limit, and who
   set it and when; technical mode adds its scope.
7. The figures are one runtime document (`/api/operator/pricing`, operators): credits per dollar, the
   margin, hosting rates, the default per-app model allowance. A change applies to the next charge and
   is audited.

## In the console

- An Admin sets, changes and removes a monthly cap on any row of *Budgets* (`PUT/DELETE /api/cascade`, budget
  `monthly_credits`; an employee's on its record); a removal says which cap then holds, or that none does.
- The Owner removes their own overdraft limit, and an Admin a part's tighter one (`DELETE /api/cascade`, setting
  `overdraft_own_limit` / `overdraft_limit`).
- An employee's row carries `employeeId` and counts its contractors' spend, as its cap does.

## Alternate and failure flows

- **A1 — a cap would be exceeded.** The call is refused 402 `budget_exhausted`, `terminal: true`, naming the
  binding scope; the run is marked and every later call for it is refused without reaching the provider.
- **A1b — past the overdraft limit.** Refused 402 `overdraft_limit`, `terminal: true`; the run is not marked,
  so it may continue once the organisation is topped up.
- **A2 — repair work.** `repair: true` reserves and records with `billable = false`; never charged, shown under `notCharged`.
- **A3 — nothing scored yet.** `estimates` is null, not zeros.

## Postconditions

- `credit_entries` only grows (grants and a statement trigger refuse UPDATE, DELETE and TRUNCATE). Balance and
  spend are always derived from it; no counter exists anywhere else.

## Rules this use case must honour

- Credits reserved before a model call, never counted after (rule 8). Repair not billed (rule 9). Overdraft has no interest or fees (rule 3).

## Acceptance

- 40 concurrent admissions against a budget fitting 13 admit exactly 13; 12 concurrent HTTP calls fitting 5 reach the provider exactly 5 times.
- Settled spend equals the reply's cost; a refusal or provider error releases the hold.

Tests: [`TEST-101`](../testing/TEST-101-control-plane.md) — `ModelGatewayTests`, `DatabaseInvariantTests`, `CascadeCreditsAndAppsTests`, `BreadthTests` (requests, limits, prices),
`FinalDefectsTests.The_credits_view_lists_every_narrower_overdraft_limit_on_and_beneath_the_scope`;
[`TEST-001`](../testing/TEST-001-console.md) — `CreditsActions.test.tsx` ("the narrower limits already set").

## Links

- Spec *Credits* · ARCH-002 (budget failures prohibited) · ARCH-003 · ARCH-004 *Credits*.
