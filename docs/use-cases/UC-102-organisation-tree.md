# UC-102 — Shape the organisation tree and what it passes down

| Field | Value |
| --- | --- |
| **ID** | UC-102 |
| **Title** | Create divisions, projects and apps; set values that inherit; grant roles; read the org chart |
| **Primary actor** | Owner · Admin · Builder (create) · Viewer (read) |
| **Scope** | Control plane (`/api/tree`, `/api/organisations|divisions|projects|apps`, `/api/cascade`, `/api/members`) |
| **Cascade level** | All four: `Organisation → Division → Project → App` |
| **Status** | Built |

## Goal

The owner builds the tree their products live in, and sets once — at whatever level — the budgets,
rule sets, context, settings, secrets and roles that apply beneath it.

## Preconditions

- Signed in. Creating a division needs Admin at the organisation; a project or app, Builder at its parent;
  deleting a project or app, Admin. Provisioning further organisations is for FrostAura operators.

## Main flow

1. `POST /api/divisions|projects|apps { parent, name, slug }` creates a node (201, `NodeView`). Slugs are
   2–40 lower-case letters, digits and single hyphens, unique among siblings; an organisation's slug may
   not take a reserved FrostAura subdomain.
2. `PATCH /api/<level>/{id} { name?, status? }` renames or changes status (statuses are fixed per level and
   constrained in the database). `DELETE` removes a node with nothing attached.
3. `PUT /api/cascade { scope, kind, key, value }` sets a value at a node; `GET /api/cascade?scope=&kind=`
   returns each effective value with `setAtLevel`, `setAtPath` and the levels it `overrides`;
   `DELETE /api/cascade?scope=&kind=&key=` removes it so the inherited value applies again.
4. `POST /api/members { scope, email, displayName, role }` grants Admin, Builder or Viewer at any node
   (only the Owner grants Admin); a new person gets a one-time invitation code, returned once and also
   e-mailed when a mail server is configured (`emailed`); they register a passkey with it and land in
   the organisation with exactly that role. `GET /api/members?scope=` lists each grant with where it
   was set; `PATCH /api/members/{id} { role }` changes it where it was set (to or from Admin, the
   Owner); `DELETE /api/members/{id}` removes it.
5. A new organisation's name may not take a FrostAura subdomain: the ops service lists them
   (`409 reserved_name`); while Cloudflare is managed and that list cannot be read, no new name is
   accepted (`503 reserved_names_unavailable`); with Cloudflare not managed here, the built-in list
   applies and `nameCheck.note` says so.
6. `GET /api/tree` returns the org chart in one document: `organisation` (with `summary`, `spend.monthCredits`,
   `workers`), `divisions[].projects[].apps[]` — every node with status words the console reads, this
   month's spend from the ledger, and its employees — plus `needsYou[]` (verdicts and approvals waiting).

7. `GET /api/cascade/below?scope=&kind=` lists what levels beneath a scope set, each with where (Viewer;
   Admin for secrets, whose values are never returned; `permission` is refused). The console's *Manage*
   screen (`/tree`, UC-001 step 24) does all of the above for divisions, projects, apps and context.

## Alternate and failure flows

- **A1 — invalid slug or status.** 400 `invalid_request`, saying which rule.
- **A2 — duplicate sibling slug.** 409 `conflict`.
- **A3 — deleting a node with children, work or credit history.** 409; archive it instead.
- **A4 — no role at a scope.** 404 (the tree's shape is not disclosed); a role too low there is 403, naming the role held and where it was set.
- **A5 — first run.** `GET /api/tree` is 200 with `organisation: null`, empty `divisions` and `needsYou` — empty because it is empty.
- **A7 — moving a node.** Not offered by any route: a node's path is part of every address, grant and value beneath it.
- **A6 — a deeper overdraft.** An organisation's overdraft is set by an operator; lower levels may only tighten it (400 otherwise).

## Postconditions

- Rows carry `organisation_id`, reference their parents by composite foreign keys, and are readable only under
  that organisation's row-level security policy. A secret's value is encrypted with the data-protection key
  ring and never returned — only that it is set.

## Rules this use case must honour

- The cascade resolver is the only implementation of inheritance (CLAUDE.md, *The cascade*).
- Roles: deepest grant wins; the organisation's Owner is never narrowed.

## Acceptance

- The tree document carries every level with real zero spend and workers; a branch member sees only their branch and the path to it.
- The resolver names the level that set a value, and inherited values return when a narrower one is removed.
- Secrets appear by name only. Bad slugs, duplicates and deletes with children are refused as problems.

- Every public endpoint, called by each role inside and outside its scope, lets it through or refuses it as its row says.

Tests: [`TEST-101`](../testing/TEST-101-control-plane.md) — `TreeEndpointTests`, `CascadeCreditsAndAppsTests`, `DatabaseInvariantTests`, `AuthorizationMatrixTests`, `BreadthTests` (names, role changes).

## Links

- Spec *The spine — one cascade*, *Four fixed member roles*, *Experience* · ARCH-002 · ARCH-004 *Identifiers and the cascade*, *Tree*.
