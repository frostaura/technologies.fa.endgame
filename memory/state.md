---
name: technologies-fa-endgame-state
description: "Whole product merged on main with every gate green; CI fails only at the Docker Hub login. The academy (327 flows, live demo, two PDFs) is published on GitHub Pages. Nothing is deployed and there are no users."
type: state
last_verified: 2026-11-26
---

# Current state

**Endgame became a project on 2026-11-24** and was built in one autonomous run to 2026-11-26,
against [`../docs/specs/endgame-build-plan.md`](../docs/specs/endgame-build-plan.md).

- **Built:** all six phases of the plan, then the gaps the flow reading found, are merged to
  `main`. An idea typed into the console is researched with live models, given a verdict, built by
  the factory part by part, and runs as a private app in its own container at its own address. An
  app can be changed in words; the change is built in a preview and everything the app did before
  is checked again.
- **Gates on `main` (run locally, 2026-11-26):** `lint build test demo-check academy-lint
  academy-test site academy-e2e demo-e2e`, all passing with zero warnings. `demo-e2e` plays every
  academy step script and variation against the demo with an empty allow-list.
- **CI on GitHub:** every job passes except the fourteen Docker Hub publish jobs, which fail at
  the login until the founder adds the secrets (`ARCH-008`). The Portainer redeploy job is off
  behind `DEPLOY_ENABLED`. No scheduled workflow exists.
- **The academy is published:** `https://frostaura.github.io/technologies.fa.endgame/` — 327 flows
  in five tracks from `docs/flows/`, each step either live in a demo build of the real console
  (an in-browser fake control plane on mock data) or pictured, with search, a free-play demo, a
  QR code and two PDFs (clients; operators). The Pages workflow republishes it on every push.
- **Walked by the orchestrator in Chrome (2026-11-25/26):** the real stack at its gateway — home,
  apps, verdict, runs, credits, hiring, people, secrets, autonomy, assistants, notifications, both
  graphs, the operator log, God mode's refusal, "Ask about this app" with a real model, and one
  real change run — and the academy's player, search, browse and live demo.
- **Model spend so far:** about US$11.50 across every spike, benchmark, factory run and check.
- **Repository:** `frostaura/technologies.fa.endgame`, **public** by founder decision
  (2026-11-24) for free CI minutes, with no licence file.
- **Clones:** the FrostAura tree (context files, `.env`) and `~/src/technologies.fa.endgame`
  (development). Lane worktrees lived under `~/src/endgame-wt/`.
- **Deployed:** nothing. The stack has only ever run on this Mac behind port 8095. Cloudflare was
  built against a local fake and never applied to the real account.
- **Users:** none. The only organisation is the local development one.

**What the market research found** (2026-11-24, five researchers): most of Endgame's parts are
already sold; nobody combines the inheriting cascade, a verdict that stops a build, uniform
services under every app, and ideas from one's own portfolio. Demand is moderate for the operating
layer and weak for the "AI employees" framing. The evidence is in the spec.

**Next gate:** the founder's review of [`../docs/assumptions-log.md`](../docs/assumptions-log.md),
then the first deployment: Docker Hub and Portainer secrets, the stack on the Mac mini, the
operators list, and FrostAura as tenant zero on it.
