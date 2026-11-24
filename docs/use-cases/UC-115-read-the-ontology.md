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
   out; signed-in end users in).

## Rules this use case must honour

- Derived on every read from what exists; nothing is stored, so there is no second source of truth. Secret values never appear.

## Acceptance

- `WorkforceTests.The_ontology_is_derived_from_the_tree_the_workforce_the_vault_and_what_each_app_used`.

## Links

- Spec, *Ontology* · UC-112.
