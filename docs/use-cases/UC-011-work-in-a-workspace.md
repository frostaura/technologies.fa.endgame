# UC-011 — Work on an app's code in a workspace

| Field | Value |
| --- | --- |
| **ID** | UC-011 |
| **Title** | Change an app's code in an isolated workspace and commit it as the employee |
| **Primary actor** | Employee (agent) or contractor (agent), through the Runner |
| **Scope** | Dock (repositories, workspaces) · Runner (caller) |
| **Cascade level** | App — the repository is the app's; the run's lease bounds the workspace's life |
| **Status** | Built |

## Goal

An agent gets a working copy of an app at a version, runs commands and edits files there — never
beside its own harness — and commits the result to the app's history under its own name.

## Preconditions

- The app's repository exists (`POST /internal/repos` created it from the app-kit template).
- The run holds a lease; the Runner passes its expiry to Dock.
- Dock's workspace image is ready (Dock builds it from the template on first start).

## Main flow

1. The Runner asks Dock for a workspace for the run at a ref (`POST /internal/workspaces`).
2. Dock creates a container from the workspace image — non-root, every capability dropped, CPU,
   memory and process limits, no socket — on an internal network of its own with a Dock-assigned
   /28 whose only way out is the egress proxy (package registries, plus any hosts given).
3. Dock copies a working copy of the repository at that ref into `/workspace`.
4. The agent runs commands (`exec`, with a timeout and output capped head-and-tail) and reads and
   writes files (paged by line; nothing outside `/workspace`, nothing in `.git`, checked again on
   the path the container resolves so a symbolic link cannot step over the floor).
5. The agent commits (`POST …/commit`, the employee as author). Dock commits inside the workspace
   with hooks disabled, carries the commits out as a bundle, and fast-forwards the app's branch.
6. The workspace is destroyed on request, or by Dock's sweep once the run's lease lapses.

## Alternate and failure flows

- **A1 — The branch moved.** Another run committed first: `409 conflict`; the workspace's commits
  are kept under `refs/workspaces/<run>` and nothing is overwritten.
- **A2 — Protected path.** `403 protected_path`, naming the rule; nothing is read or written.
- **A3 — Long command.** Stopped at its timeout; `timedOut: true` and the output so far.
- **A4 — Lease renewed.** `PUT …/lease` moves the expiry; the sweep honours it across Dock restarts.

## Postconditions

- The app's branch head is the employee's commit, with the employee as author and Endgame as
  committer; the history is intact and every earlier version restorable.

## Rules this use case must honour

- Tools run in the workspace container; the harness runs outside it (rule 6).
- The protected-path floor nothing overrides (rule 7).
- No socket, host networking or unrestricted egress for a workspace ("Never do here").

## Acceptance

- Exec as uid 1654, no socket, the given limits, zero effective capabilities.
- Registries reachable through the proxy; anything else, and anything direct, refused.
- `../`, absolute, `.git` and symbolic-link escapes refused on read, write and working directory.
- A lapsed lease destroys the workspace and its network; a renewed one does not.

## Links

- ARCH-004 (*Dock — internal API*) · ARCH-005 · TEST-010
