# UC-112 — Hire and manage the workforce

| Field | Value |
| --- | --- |
| **ID** | UC-112 |
| **Title** | Raise a need, hire on a proposal, and move, change, release or rehire employees; brief contractors |
| **Primary actor** | Owner · Admin (decide, change); Viewer (read); the Runner (raises needs, briefs contractors) |
| **Scope** | Control plane (`/api/employees*`, `/api/hires*`, `/internal/hires`, `/internal/employees*`, `/internal/contractors*`) |
| **Cascade level** | The node an employee works at; budgets, autonomy and `workforce.idle_days` inherit down to it |
| **Status** | Built (control-plane side) |

## Goal

The organisation has the staff its work needs and no more: each employee hired for a stated reason at a
known monthly cost, with a job description and a track record the owner can read, and nobody idle on the bill.

## Preconditions

- Deciding, editing, moving and releasing need Admin at the employee's (or proposal's) node; reading needs Viewer.

## Main flow

1. **A need is raised.** The Runner, from the ontology (a new division, a project entering a stage, a recurring job),
   calls `POST /internal/hires { scope, trigger, needKey, reason, name, role, jobDescription, expectedMonthlyCredits }`;
   the owner calls `POST /api/hires`. The same `needKey` raised again answers the live proposal (200), not a second one.
2. **Auto-mode decides within budget.** When the expected monthly cost fits the headroom at the scope (the tightest
   monthly cap, or the balance down to the overdraft) and the hire checkpoint is off, the proposal is accepted at once
   (`decision.via: auto-mode`) and the employee exists.
3. **Otherwise it waits** in `GET /api/tree` → `needsYou[] { kind: "hire" }`. The owner edits it (`PATCH /api/hires/{id}`),
   accepts it (`POST …/accept`) or declines it (`POST …/decline`).
4. **The employee works.** Its job description (mandate, scope, tools, services, monthly credit limit, model tier),
   manager (`reportsTo`), status and current run are on `GET /api/employees/{id}` and on the org chart.
5. **Movement.** `POST …/reassign { scope, reportsTo? }` moves it (its memory travels); `PATCH` changes budget, tier,
   tools, mandate or manager, or pauses and resumes it; `POST …/release` lets it go (memory archived; anyone who reported
   to it moves up); `POST …/rehire { scope? }` brings it back with its memory.
6. **Contractors.** The Runner calls `POST /internal/contractors { scope, briefedBy, role, brief, runId }`; the contractor
   is on the chart while it works and its model calls carry its id. `POST …/{id}/finish { learned[] }` takes it off the
   chart and writes what it learned to its briefer's memory. A role briefed three times at one node in thirty days, with no
   employee in it, is proposed as a hire (`trigger: promotion`).
7. **Idle.** An employee idle for longer than `workforce.idle_days` (default 14) is flagged; where autonomy is auto the
   sweep releases it, otherwise it waits in `needsYou[] { kind: "idle" }`.

## The Runner's triggers

| When | Trigger · need key | Role (name) | At |
| --- | --- | --- | --- |
| Research first reaches a scope | `stage` · `stage:research:<scope>` | Market researcher (Iris) | the idea's scope |
| Placement creates a division | `division` · `division:<division path>` | Division lead (Sol) | the division |
| A project enters its build | `stage` · `stage:build:<project path>` | Software engineer (Theo) | the project |
| A project enters evaluation | `stage` · `stage:evaluate:<project path>` | QA engineer (Nadia) | the project |
| A published app declares a recurring job | `recurring` · `recurring:<app path>` | Operations engineer (Ravi) | the app |

Expected monthly credits per role are `Runner:MonthlyCredits`. Research contractors are registered with `briefedBy` the
researcher and finished with what they learned.

## Alternate and failure flows

- **A1 — a standing hire.** The security reviewer, created with every organisation, cannot be released: `409 standing_hire`.
- **A2 — a bad job description.** An unknown model tier, a service the platform does not offer or a reporting loop is `400`,
  before anyone could accept it.
- **A3 — releasing someone mid-run** is `409`; a decided proposal decided again is `409`.
- **A4 — a contractor over its briefer's cap.** Its model call is `402 budget_exhausted`, naming `employee:<briefer>`.

## Postconditions

- `employees` and `hire_proposals` rows; a decision records who (or auto-mode) took it. Nothing is counted on the employee:
  the track record is derived from its runs, their logs and the ledger whenever it is read.

## Rules this use case must honour

- Caps at every level, employees included (spec, *Credits*); one source of truth for spend (ARCH-002); finishing a run moves
  the employee's state in the same transaction (ARCH-002); an idle workforce is never paid for (spec, *Workforce*).

## Acceptance

- `WorkforceTests`: the standing reviewer; auto-hire within budget and one proposal per need; over budget or at a checkpoint
  the owner edits, accepts and declines; the derived track record; movement and release; contractors and promotion; idle.

## Links

- Spec, *Workforce* · ARCH-002 · ARCH-004 *Workforce* · UC-113 (memory) · UC-115 (ontology).
