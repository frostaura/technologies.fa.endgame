---
name: technologies-fa-endgame-watch
description: "Nothing deployed or proven outside this Mac: passkeys in a real browser, HTTPS, the tunnel, real mail and God mode on the real stack are unverified. Margin and hosting rates are placeholders. Small factory and console debts listed."
type: watch
last_verified: 2026-11-26
---

# Known debts

The debts from the first real run (the verdict page, "Ask about this app", the empty track
record, estimate accuracy, hosting cost) were fixed and seen fixed on the real stack on
2026-11-26. What is listed here is still owed.

**Not verified anywhere yet**
- Passkey ceremonies in a real browser on the real stack — every walk used the development
  sign-in. The demo's device sheet stands in for them in the academy.
- God mode on the real stack: the development account is not in `ENDGAME_OPERATORS`, so only the
  refusal was seen there; the screens were walked in the demo and by tests.
- HTTPS, the Cloudflare tunnel, and anything applied to a real Cloudflare account.
- A real SMTP server. Mail only ever reached the local catcher.
- The Docker Hub publish and the Portainer redeploy: the jobs exist and have never succeeded.
- More than a handful of apps on the real stack, and waking after the host restarts.
- Shared apps with invitation codes end to end on the real stack (covered by the acceptance
  test's replay and by tests, not walked by the orchestrator).

**Founder's numbers still owed**
- The credit margin is 1.0 (none); the hosting rates and the 500-credit monthly model cap per app
  are placeholders (assumptions log, entry 15).

**Seen in the real change run of 2026-11-26 — owed**
- An app whose `PROGRESS.md` was written in the builder's own words (built before the factory
  wrote that file itself) has a to-do line read as "a part the app already had", so the
  regression part of a change is checked against a sentence that cannot be shown in a running
  app. It cost two unbilled repair rounds before passing. `BuildWorkflow.EarlierWork`.
- The run timeline says "Someone took on a task" although the task carries who.
- Each finished task prints "Task done" twice with the same sentence.
- An employee's "Estimates" card counts builds only; a change run's parts show "No estimate".
- A lesson's title in "What Theo remembers" is a cut-up sentence ("… [17 characters cut] …").
- The change cost 22 credits against 19 estimated, and 15 credits of repair went unbilled: the
  platform absorbs repair, so the margin question above matters.

**Academy — owed**
- Six steps point at a brief busy word (ASK-01 to ASK-03, IDEA-01, PPL-03, SEC-03); they depend
  on how long the fake server takes and are not covered by the same-moment check, which holds
  only the `ID-` flows.
- On a phone the console header cuts the organisation name very short beside a long last crumb.
- Two pictures keep a caption close to its target (HOST-06 variation 1, PPL-08 step 4).

**Product gaps recorded as flows, by decision or still open**
- Nothing can be moved in the tree (TREE-10, deliberate). The spec's design stage does not
  exist in the build (BLD-12). The smoke test through the edge is command line only (OPS-07).
- Over MCP: `employee_update` cannot set a cap, and there are no tools for sharing, keys, read
  marks, top-up requests, the operator log or the dashboard.
- The ops rehearsal uses a fixed compose project name; the ops container logs "Cannot load
  library libgssapi_krb5.so.2" at start; CI tears down with `make docker-down`.

**Environment**
- A lane once ran `npm` from the home folder, which holds the founder's own `package.json`
  (2025). Its `node_modules` there may want an `npm install` by him. Never run npm from a
  directory that is not the project's own.
