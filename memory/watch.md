---
name: technologies-fa-endgame-watch
description: "Debts owed after the first lane merges: dev sign-in tied to the Development environment, operator rights on unverified e-mail, zero credit margin, contract docs behind the code, console sections with no endpoint yet."
type: watch
last_verified: 2026-11-24
---

# Known debts

Found while merging and walking the first two build lanes on 2026-11-24. Each is owed, none is fixed.

**Security and money**
- **Operator (God-mode) rights go to any `frostaura.net` e-mail, and e-mails are not verified** — the
  first person picks their own. Until e-mail is verified, operators must come from an explicit
  list, not from the address someone typed.
- **The credit margin defaults to zero.** The spec wants cost plus one fixed margin.
- **The sweep that releases lapsed credit reservations has no test.**
- **Shared and public app access is refused** by the control plane until Edge enforces it.

**Running the stack**
- **The development sign-in needs the Development environment, and that environment makes services
  look for each other on host ports.** Locally only the control plane runs in Development, through
  an untracked compose override; its own status view then reports the other services unreachable.
  Service addresses must come from explicit settings, not from the environment name.
- The control plane's migration needs a superuser and assumes the tree tables are empty.

**Docs behind the code**
- `ARCH-004` does not yet carry what the control plane added: app addresses include the app's own
  slug (`/org/division/project/app/`), the run-claim and employee endpoints, the estimate and
  conversation-history endpoints, and the vocabulary the console uses for statuses.
- `ARCH-001` still describes the scaffold's single status page and its empty data model.

**Console**
- Built against the contract only: no Employee screen, "ask about this app", version history,
  hire proposals, invitations, overdraft change or top-up request, because no endpoint exists yet.
- App telemetry and running cost arrive as null until something measures them; the console must
  show that as "not measured yet", never as zero.
- The phone header wraps to three rows; the app page is sparse on desktop.
- Colour contrast is test-enforced only for the pairs the token tests list.
