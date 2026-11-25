# UC-116 — Use Endgame over MCP

| Field | Value |
| --- | --- |
| **ID** | UC-116 |
| **Title** | Make an access token and drive the organisation, and each app, from an MCP client |
| **Primary actor** | Owner · Admin · Builder · Viewer, through an MCP client (an assistant, an agent, a script) |
| **Scope** | Control plane (`/api/tokens`, `/mcp`, `/mcp/apps/{appId}`); Edge's control listener for app calls |
| **Cascade level** | The token's organisation; every call at the scope it names, as the cascade resolves it |
| **Status** | Built (the per-app surface needs Edge's `/internal/apps/{id}/call/*`, owed) |

## Goal

Anything possible in the console is possible over MCP (spec, *Shared services*), with the same
roles and the same human-only rules, and every app answers MCP too, from what it already declares.

## Preconditions

- A member, signed in at the console, with a role somewhere in the organisation.

## Main flow

1. `POST /api/tokens { name, organisation, role? }` → `{ token: "egp_…", accessToken }`. The token is
   shown once and kept only as a hash; its role is at most the person's highest in the organisation,
   never `owner` (an Owner's token is an Admin).
2. The client connects to `https://<console>/mcp` with `Authorization: Bearer egp_…` (streamable HTTP).
3. `tools/list` returns the organisation's tools (`tree_get`, `node_create`, `idea_submit`,
   `idea_decide`, `run_control`, `approval_answer`, `credits_get`, `budget_set`, `employee_update`,
   `hire_decide`, `autonomy_set`, `member_invite`, `secret_set`, `app_settings`, `app_ask`,
   `app_restore`, … — the full list is in ARCH-004).
4. `tools/call` runs the same service the console's endpoint runs, behind the same role check at the
   named scope, held also to the token's role.
5. For one app: connect to `/mcp/apps/{appId}`; the tools are the app's own operations, derived from
   its OpenAPI document; a call reaches the app with a member session for the token's person.
6. `GET /api/tokens` shows each token's last use; `DELETE /api/tokens/{id}` revokes it.

## Alternate and failure flows

- **A1 — a role too low.** The tool result is an error `{ status: 403, code: forbidden, detail }` naming the role needed (and that the token caps it).
- **A2 — another organisation, or a branch the person has no role in.** `404`: its shape is not disclosed.
- **A3 — human-only.** `access: public` (`403 human_only`), an organisation's overdraft, top-ups and the export are refused or absent; a breached red line refuses a build for everyone.
- **A4 — revoked, expired or unknown token; or a cookie on `/mcp`.** `401`.
- **A5 — the app does not describe itself, or cannot be reached.** `502 app_openapi_unavailable` / `app_unreachable`; an app's own 4xx is an error result carrying its `code`.

## Postconditions

- Whatever the tool did is recorded exactly as the console's action is (who: the person; actor: `mcp`).
  Model work started over MCP is estimated and charged as from the console.

## Rules this use case must honour

- Go-public is a human act (rule 10). Secrets are never returned. God mode is never silent — and never available to a token (rule 1).

## Acceptance

- The SDK's own client lists and calls control-plane tools and a derived app tool in process.
- Every tool, called by each role inside and outside its scope, is let through or refused exactly as the public endpoint is.

Tests: [`TEST-101`](../testing/TEST-101-control-plane.md) — `McpTests`, `AuthorizationMatrixTests`.

## Links

- Spec *Shared services* (MCP) · ARCH-004 *MCP* · PLATFORM-API §2 (the app's OpenAPI document).
