---
name: technologies-fa-endgame-state
description: "All six phases merged; an idea becomes a running private app for real and the three acceptance tests passed on a local stack. CI on GitHub is red, a defect lane is open, nothing is deployed, no users."
type: state
last_verified: 2026-11-25
---

# Current state

**Endgame became a project on 2026-11-24.** It was specified that day with the founder, market
researched, designed and planned, then approved for Phase 0 of
[`../docs/specs/endgame-build-plan.md`](../docs/specs/endgame-build-plan.md).

- **Phase:** all six phases of the build plan are merged to `main`; a last lane is fixing the
  defects in [watch](watch.md) and getting CI green. Cloudflare was built against a local fake
  and never applied to the real account.
- **Proven for real, 2026-11-25:** an idea typed into the console is researched with live models
  and web search, given a verdict, and — when built — becomes a private app running in its own
  container at its own address. The orchestrator did this itself in Chrome (a reading-list app)
  and used the result. Repair after a failed evaluation and one-step model escalation were seen
  working in a later run.
- **The plan's three acceptance tests passed, run by an agent on its own stack:** FrostAura as
  tenant zero with a workforce hired by the factory; a court-booking app (bookings that cost
  minutes, an admin adding minutes, a signed hardware endpoint, a confirmation e-mail, a call
  through the app's derived MCP tools) on its second build; and an invited organisation whose
  owner registered a real passkey, built an app, shared it by e-mail, and was invisible to the
  first organisation. Parts of the second and third were finished by replaying against apps
  already built, not in one unbroken run.
- **Suite on `main`:** 610 backend tests, the console's, the app kit's, the operations service's
  and the outage page's, all passing with zero warnings when last run by a lane. **CI on GitHub
  was red** on the last pushes: one console test fails on the Linux runner, and the jobs after it
  have never run there.
- **Model spend so far:** about US$9.20 across every spike, benchmark and factory run.
- **Repository:** `frostaura/technologies.fa.endgame`, **public** by founder decision on
  2026-11-24, for free CI minutes. He accepts that it may be cloned before he later makes it
  private. It carries no licence file, so nothing is granted to anyone who does.
- **Clones:** the FrostAura tree (context files, `.env`) and `~/src/technologies.fa.endgame`
  (development).
- **Built:** nothing that turns an idea into a running app yet — no harness, no app hosting.
- **Deployed:** nothing. No address serves Endgame.
- **Users:** none.
- **Design:** six console screens exist as a Claude design canvas, private to the founder
  (`https://claude.ai/artifact/Ps6zam7X4N78Yz2uQAfEp5`). They were never rendered or checked by the
  agent that drew them.

**What the market research found** (2026-11-24, five researchers): most of Endgame's parts are
already sold; nobody combines the inheriting cascade, a verdict that stops a build, uniform
services under every app, and ideas from one's own portfolio. Demand is moderate for the operating
layer and weak for the "AI employees" framing. The evidence is in the spec.

**Next gate:** Phase 1's four spikes. The harness spike is the one that can reopen a founder
decision — if Endgame's own loop cannot build a real feature on any affordable model tier, stop and
bring that to the founder.
