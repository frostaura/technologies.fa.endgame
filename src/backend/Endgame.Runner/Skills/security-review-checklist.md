---
name: security-review-checklist
trigger: Reviewing an app before it is published, for misuse of the platform's services.
---
# Security review checklist

Check every item against the code; a finding blocks publishing. Report each as pass or finding, with the
file and line and what to change.

## Secrets
- No key, token, password or connection string in code, config, tests, docs or the front end (search for
  `key`, `secret`, `token`, `password`, `Bearer`, `sk-`, `connectionString`).
- Secrets are read through `IEndgameSecrets`, at the point of use, never logged and never returned by an endpoint.

## Identity and access
- Every endpoint that writes, or reads someone's own data, has `.RequireUser()` and takes `EndgameUser`. A handler
  that takes `EndgameUser?` (signed in or not) is a finding: it reads the person's own data when they are signed in.
  The one exception is the kit's own `getCurrentUser` (`GET api/me`). What anyone may see — a count, a total — belongs
  on the public resource, readable signed out, never beside someone's own record (the app kit's "A person's own
  record"; the app's `AppRulesTests` checks this too).
- Ownership is checked: a user reads and changes only what is theirs (look for queries by id with no owner filter).
- Owners are stored as `EndgameUser.Id`, never an email. No home-made sessions, cookies or password handling.
- Nothing trusts origin-scoped browser storage for identity or authorisation (apps on paths share an origin).

## Data
- All database access is through `AppDb` and EF Core; no raw SQL built by string concatenation.
- Every schema change is a migration; no migration was edited after it was committed.
- No endpoint returns entities wholesale or fields the caller should not see.

## Model calls
- Models are called only through `IEndgameModels`, from the server, never from the browser, with a task type.
- A model's output is treated as untrusted text: never executed, never used as SQL or a URL, escaped when shown.
- `BudgetExhaustedError` is handled in the UI; nothing retries a refused budget.

## Outbound calls
- Outbound HTTP goes through the default client (the kit routes it through the egress proxy); no custom
  proxies, sockets or disabled certificate checks.
- Inbound webhooks use `MapWebhook` with verification against a vault secret.

## Front end
- No URL starts with `/`; no scripts, fonts or styles from other hosts; no `dangerouslySetInnerHTML` with
  user or model text.
