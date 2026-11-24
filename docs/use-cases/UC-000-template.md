# UC-000 — Use-case template

> Copy to `UC-<nnn>-<short-name>.md`. One use case per file: one actor, one goal. Delete these
> quoted notes in the copy.

| Field | Value |
| --- | --- |
| **ID** | UC-nnn |
| **Title** | Verb phrase naming the goal |
| **Primary actor** | Owner · Admin · Builder · Viewer · app end user · employee (agent) · contractor (agent) · system |
| **Scope** | Which service(s) carry it: Edge · Control plane · Runner · Dock · Console |
| **Cascade level** | Organisation · Division · Project · App — where it applies and what it inherits |
| **Status** | Proposed · Accepted · Built · Retired |

## Goal

One or two sentences: what the actor wants and why it matters to them.

## Preconditions

- What must already be true (identity, role at a cascade level, credit balance, budget headroom).

## Main flow

1. The actor …
2. The system …

## Alternate and failure flows

- **A1 — …** What happens, and what the actor sees. A failed read is never shown as an empty result.

## Postconditions

- What is now true, what was recorded, and what was charged in credits (estimate shown first).

## Rules this use case must honour

- Name the `CLAUDE.md` conventions that apply (e.g. permission check before every tool call,
  credits reserved before a model call, go-public is a human act).

## Acceptance

- Observable, testable statements. Each maps to a test in `docs/testing/`.

## Links

- Spec section · architecture doc · test plan.
