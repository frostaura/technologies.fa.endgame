# ARCH-000 — Architecture document template

> Copy to `ARCH-<nnn>-<short-name>.md`. Describe what is **built**, not what is planned; a planned
> part is named as planned, in its own section. A stale architecture doc blocks feature work.
> Delete these quoted notes in the copy.

| Field | Value |
| --- | --- |
| **ID** | ARCH-nnn |
| **Title** | |
| **Status** | Draft · Current · Superseded by ARCH-nnn |
| **Covers** | Services, projects or modules this describes |

## Context

What problem this part of the system solves, and the constraints it works under.

## Components and boundaries

Each component, what it owns, and what it is forbidden to do. Name the trust boundary each call
crosses.

## Interfaces

Endpoints, messages, ports and adapters, with their contracts. Link the OpenAPI document where one
exists.

## Data

Entities, tables, ownership, retention. Who may read and write what.

## Invariants

Statements that must always hold, and where each is enforced (code, database constraint, test).

## Decisions

| Decision | Why | Alternatives rejected |
| --- | --- | --- |

## Not built yet

Parts of the target design that do not exist in the code. Never describe these above.

## Links

Use cases · test plans · spec sections.
