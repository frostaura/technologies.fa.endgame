# UC-111 — Hosting is metered, the overdraft holds, and God mode is audited

| Field | Value |
| --- | --- |
| **ID** | UC-111 |
| **Title** | Dock reports hosting usage as credits; work stops and apps pause at the overdraft limit; operators' entries are logged for the Owner |
| **Primary actor** | Dock; a FrostAura operator; the organisation's Owner |
| **Scope** | Control plane `/internal/usage/hosting`, `/internal/routes`, `/api/credits`, `/api/cascade`, `/api/operator/organisations`, `/api/audit/operator-access`; the sweep |
| **Cascade level** | `overdraft_limit` (operator, organisation) → `overdraft_own_limit` (Owner, organisation) → `overdraft_limit` below; `monthly_credits` budgets |
| **Status** | Built (control-plane side); Dock does not send usage yet |

## Main flow

1. Dock posts per-app usage samples (`awakeSeconds`, `memoryBytes`, `storageBytes`, `requests` over a period).
   Each becomes one `hosting` ledger entry: US$ at the `Hosting` rates, converted by the one margin factor.
   The same `sampleId` is charged once.
2. Hosting counts as spend everywhere: the balance, every monthly budget, the credits view (`month.hosting`)
   and the app's cost and expected running cost.
3. An organisation may run below zero down to its effective overdraft. Past it, the routing table marks its
   apps `paused` (`pausedReason: overdraft_limit`) and model calls are refused with 402 `overdraft_limit`.
   A spent budget above an app pauses it too (`budget_exhausted`). A top-up restores everything at once.
4. An operator — only an address in `ENDGAME_OPERATORS` — lists every organisation and enters one as Admin;
   each entry (one per operator per organisation per ten minutes) is written to `operator_actions`, which the
   Owner reads at `/api/audit/operator-access`, with every other operator action.
5. The sweep releases reservations that lapsed with their lease and requeues runs whose lease lapsed.

## Alternate and failure flows

- **A1 — limits.** The organisation's own limit may be tighter than FrostAura's, never deeper (400); only the
  Owner sets it, only an operator sets FrostAura's (403).
- **A2 — bad samples.** Longer than 24 hours, negative, or awake beyond the period: 400; an unknown app: 404.

## Rules this use case must honour

- Overdraft carries no interest and no fees (rule 3): nothing in the ledger accrues with time.
- God-mode entry is never silent (rule 1).

## Acceptance

- The balance past the limit equals top-ups less what was spent, before and after time and the sweep.

Tests: [`TEST-102`](../testing/TEST-102-platform-api.md) — `ControlPlaneDebtsTests`.
