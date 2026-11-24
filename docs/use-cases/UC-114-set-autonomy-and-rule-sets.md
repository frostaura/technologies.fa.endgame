# UC-114 — Set autonomy, checkpoints and stage rule sets

| Field | Value |
| --- | --- |
| **ID** | UC-114 |
| **Title** | Choose how much the workforce does on its own, where it stops for sign-off, and what each stage may do |
| **Primary actor** | Owner · Admin (set); Viewer (read); the conversation (an allow-listed setting, after the owner confirms) |
| **Scope** | Control plane (`/api/autonomy*`, `/internal/cascade`, `/internal/context`) |
| **Cascade level** | Set once for the organisation, narrowed for a division, project or app |
| **Status** | Built |

## Main flow

1. `PUT /api/autonomy { scope, autonomy: auto|checkpoints, checkpoints: { start, plan, hire } }` sets the settings
   `autonomy`, `checkpoint.start`, `checkpoint.plan`, `checkpoint.hire`. A checkpoint stops work only where autonomy is
   `checkpoints`.
2. `PUT /api/autonomy/rule-sets { scope, stage, deny, ask, allow, checkpoints }` sets the rule set for a stage (`research`,
   `plan`, `build`, `evaluate`, `review`, `conversation`) or `all`. Rules are written as the harness reads them:
   `tool` or `tool(pattern)`.
3. `GET /api/autonomy?scope=` shows what is in effect and where each value was set; `DELETE` lets the inherited one apply again.
4. The Runner reads them through `GET /internal/context` (`settings`, `ruleSets`) before every run.

## Alternate and failure flows

- **A1 — a value the harness could not apply** (an unknown mode, stage or malformed rule) is `400`.
- **A2 — a Builder** reads but cannot set: `403`.
- **A3 — an agent** may change only `autonomy`, the checkpoints, `sleep.*` and `workforce.idle_days`
  (`PUT /internal/cascade`); anything else, `access` above all, is `403 setting_not_allowed`.

## Acceptance

- `RunnerContractTests.Autonomy_and_stage_rule_sets_resolve_down_the_cascade_and_reach_the_runner`,
  `…The_conversation_starts_an_idea_and_changes_only_the_settings_an_agent_may`.

## Links

- Spec, *Autonomy* · ARCH-006 · UC-201.
