# UC-115 — Read the organisation as a graph

| Field | Value |
| --- | --- |
| **ID** | UC-115 |
| **Title** | See who is responsible for what, what depends on what, and how data flows |
| **Primary actor** | Owner · Viewer (the org-chart and data-flow views); the Runner (hiring triggers) |
| **Scope** | Control plane (`GET /api/ontology`, `GET /internal/ontology`) |
| **Cascade level** | The scope asked for and everything beneath it |
| **Status** | Built |

## Main flow

1. `GET /api/ontology?scope=&view=all|org-chart|data-flow` → `{ nodes, edges, views }`.
2. Nodes: the tree's nodes, employees and working contractors, members, secrets by name, each app's declared webhooks and
   schedules, and the platform services apps have used. Edges: `owns` (tree, secrets, declarations), `works-on` (employees,
   contractors and members, with role or current work), `reports-to` (managers and briefers), `depends-on` (an app on each
   platform service it has called), `data-flows-to` (webhooks and schedules into an app; an app's mail, prompts and telemetry
   out; signed-in people in). An app uses **identity** when anyone has signed in to it (an app session, a member's
   or an end user's), registered as its end user, or been invited to it (a share) — so a private app its members
   open depends on identity though it has no end users.

## Rules this use case must honour

- Derived on every read from what exists; nothing is stored, so there is no second source of truth. Secret values never appear.

## Acceptance

- `WorkforceTests.The_ontology_is_derived_from_the_tree_the_workforce_the_vault_and_what_each_app_used`.
- `FinalDefectsTests.An_app_people_sign_in_to_depends_on_identity_in_the_data_flow_even_with_no_end_users` (a member's
  session, a share, and an app with neither).

## Links

- Spec, *Ontology* · UC-112.
