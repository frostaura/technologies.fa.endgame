# TEST-000 — Test plan template

> Copy to `TEST-<nnn>-<short-name>.md`. One plan per use case or architectural part. A green run
> proves the code you changed works; the "running system" section proves you changed the right
> code. Delete these quoted notes in the copy.

| Field | Value |
| --- | --- |
| **ID** | TEST-nnn |
| **Covers** | UC-nnn · ARCH-nnn |
| **Status** | Draft · Current · Retired |

## What must be true

The acceptance statements from the use case, one per line, each with its test below.

## Tests

| Level | Where | What it proves |
| --- | --- | --- |
| Unit | `src/backend/Endgame.Tests/…` · `src/frontend/src/…test.ts` | |
| Integration | `WebApplicationFactory` tests | |
| End to end | `src/frontend/tests-e2e/…` against `make up` | |

## Fixture variation

For each test that passes, the one setup field that, changed, should make it fail — and proof it does.

## Against the running system

The manual or scripted check on the real stack (`make up`, through the edge on its published port),
and what was observed.

## States covered

Loading · success · empty (when it is genuinely empty) · failed read · stale after a failed refresh.
