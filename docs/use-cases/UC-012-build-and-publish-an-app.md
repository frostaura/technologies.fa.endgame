# UC-012 — Build and publish a version of an app

| Field | Value |
| --- | --- |
| **ID** | UC-012 |
| **Title** | Build an image from a commit and start it as the app's running version |
| **Primary actor** | System (the factory's publish stage, through the Runner) |
| **Scope** | Dock (builds, lifecycle, database provisioning, egress) · Control plane (receives `published`) |
| **Cascade level** | App |
| **Status** | Built |

## Goal

A commit on the app's branch becomes the running version, with its own database and role on the
shared server and an outbound allow-list of its own, and the control plane is told.

## Preconditions

- The commit exists in the app's repository.
- The control plane has minted the app's token.

## Main flow

1. `POST /internal/apps/{id}/build` with a ref. Dock copies the tree at that commit into a
   throwaway container of the workspace image — no socket, an internal network whose only way out
   is the proxy to the package registries — and runs `endgame-build`: every front end built into
   `wwwroot`, then a ReadyToRun, framework-dependent publish on the chiseled base written as an
   image archive. No Dockerfile per app; never trimmed, never Native AOT.
2. Dock loads the archive through the Engine API as `app-<id>:<commit>` and removes the build
   container and its network.
3. `POST /internal/apps/{id}/start`. On first use Dock creates the app's internal network (a /28
   it assigns, joined by Edge, the database server and the proxy — never by Dock), its database
   and role (opaque names, a connection cap, `CONNECT` for that role only, `CONNECT` revoked from
   `PUBLIC` on every platform database), and its egress allow-list.
4. Dock creates the container hardened (read-only root, no-exec `/tmp`, no new privileges, every
   capability dropped, memory, CPU and process limits, uid 1654, no mounts) with the app-kit
   environment, and starts it through the staggered wake gate after a memory-budget check.
5. A new commit replaces the container; Dock reports `POST /internal/apps/{id}/published`.

## Alternate and failure flows

- **A1 — The app does not build.** `422 build_failed` with the log's tail; nothing changes.
- **A2 — An image not built for this app** is refused (`400`): only Dock's own builds run.
- **A3 — No room.** `503 capacity`; the previous state stands.

## Postconditions

- The app runs the new version; its data is untouched; the control plane knows the commit and image.

## Rules this use case must honour

- Only Dock touches Docker (rule 5); no app is given the socket.
- Dock never deletes data: retiring an app removes its container and network, never its database,
  repository or images.

## Acceptance

- The image is ReadyToRun on the chiseled base and starts under every hardening rule.
- Two apps cannot open each other's databases or the platform's.
- Egress is denied by default and allowed per app; a changed allow-list applies without a restart.

## Links

- ARCH-004 · ARCH-005 · TEST-010
