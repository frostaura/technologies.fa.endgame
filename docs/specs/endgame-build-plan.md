# FrostAura Endgame — build plan

> **The build plan for `technologies.fa.endgame`, approved by the founder.** Companion to
> [`endgame-spec.md`](endgame-spec.md), which holds every product decision. Which phase is live is
> in `MEMORY.md`. Items marked **FLAG** were raised for the founder; which are still open is in
> the memory store.

## Constraints carried in

- The first version is the whole product; the order below is sequence, not scope.
- **Endgame writes its own agent harness.** Outside harnesses are studied, never run.
- **Two external services only: Cloudflare and OpenRouter.** Everything else runs in the stack.
- Mandated stack: .NET 10, EF Core, PostgreSQL; React, TypeScript, Redux Toolkit, Tailwind,
  shadcn/ui. Zero warnings. Passkeys. No scheduled CI. No placeholders.
- Runs on one Mac mini in Docker behind a Cloudflare tunnel. No paid add-ons.
- Project id `technologies.fa.endgame`; code in `~/src`, context files in the tree.

## What runs — the stack

| Service | Job |
| --- | --- |
| **Edge** | The only door. Routes both address shapes to the console or an app, wakes sleeping apps on the first request, puts idle ones to sleep, serves the paused page. Kept separate so a control-plane restart never drops live apps. |
| **Control plane** | The organisation tree and cascade, identity, vault, credits, model gateway, scheduler, telemetry intake, MCP gateway, version history. One .NET service, hexagonal layering. |
| **Runner** | Hosts the agent harness: runs every agent session, the factory workflows, the task queue. |
| **Dock** | The only service allowed to control Docker. Builds app images, starts and stops app containers and agent workspaces, enforces limits. |
| **Console** | The React front end — the design already drawn. |
| **PostgreSQL** | One server: the platform's own database, plus one database and one role per app. |
| **Egress proxy** | The only way out for apps and workspaces. Default-deny, allow-list per app. |
| **Tunnel, backup** | Cloudflare tunnel; nightly encrypted backup to Cloudflare storage. |

Each generated app is **one container**: its API serves its own built front end. Images are
produced with .NET's built-in container publishing — no Dockerfile per app. Sleep is stop-and-keep,
not remove, so waking is fast. Every app sits on its own internal network with CPU, memory and
process limits.

## The harness — the core of the product

Written in .NET, provider-neutral, talking to OpenRouter in the common chat-and-tools format. It
borrows the published patterns of the best coding agents and owns every line.

1. **Kernel.** The loop: model call, tool calls, results, repeat. Streaming. **Event-sourced** —
   every step is appended to a run log in PostgreSQL, so a run survives a crash, resumes from a
   checkpoint, can be replayed, and drives the live trace in the console.
2. **Tools.** Read, exact-replace edit and whole-file write; shell; search; version control; test
   runner; a real browser for checking the running app; web search and fetch; platform tools
   (provision, publish, services). Tools execute **inside a workspace container**; the harness
   itself stays outside it, so generated code never runs next to the agent's own machinery.
3. **Permissions.** A policy check before every tool call: deny rules, then the cascade's rule
   sets, then the run's mode, then allow rules. A protected-path floor that nothing overrides.
   Unattended, anything that would have asked is denied — unless a checkpoint is set there, in
   which case the run pauses and the owner is asked.
4. **Plan before build.** Every piece of work starts as a written contract: what will be made and
   how it will be checked. The contract is stored, shown, and is what the evaluator marks against.
5. **Tasks.** A persistent task graph — dependencies, owner, status, estimate, actual cost.
   Atomic checkout so two agents never take one task; a wake-up queue that merges duplicates.
6. **Sub-agents.** Each gets its own context and a brief (objective, output format, boundaries)
   and returns a short summary. Contractors are sub-agents. Parallel lanes work in separate
   working copies. A cap on fan-out, sized to the task.
7. **Context.** Compaction near the limit; notes kept outside the context; retrieval just in time.
   Each app's repository carries a short map file and a docs store — the repository is the record.
8. **Memory.** Employee memory as curated topic files, reviewed and pruned on a schedule; the
   organisation's context inherited down the cascade.
9. **Skills.** Packaged procedures loaded on demand — only a name and a one-line trigger sit in
   context until needed.
10. **Workflows.** The factory's stages are **deterministic code**: code owns loops, gates and stop
    conditions; agents supply judgement inside them. The build stage is planner → builder →
    a separate, sceptical evaluator that drives the live preview against the contract — one
    feature per session, a clean commit each, a progress file, a capped number of repair rounds.
11. **Hooks.** Before and after tools, and on stop — used to enforce format, lint, tests and house
    rules, with error messages that say how to fix the fault.
12. **Budgets.** Credits are **reserved before each model call**, not counted afterwards, so a cap
    is exact. Estimates come from the task graph and past cost by task type. Repair work after a
    failed check is flagged non-billable.
13. **Model routing.** Each task type has a price ceiling; the router picks within it. A fixed
    **benchmark of real build tasks** measures edit and tool-call reliability per model tier, sets
    the routing table from data, and is re-run whenever a model changes.
14. **Tracing.** Every model and tool call is a span; the console shows it live.

## The app kit

A template plus a library for both halves of an app — identity, data, secrets, models, inbound
webhooks, outbound calls, schedules, email, telemetry. Because every app is built on it, the
platform derives each app's MCP tools from the app's own published interface, and telemetry needs
no work by the author. Agents build against the kit, never against a blank machine.

## Phases

**Phase 0 — Gates and ground.**
Run the red-lines and belongs-in-FrostAura gates (the surveillance line needs an explicit answer for
God mode, telemetry and the agent trace). Create the project: directory, context pair, all three
registries, the GitHub repository, the `~/src` clone. Scaffold from the proven templates — Reel's CI,
Makefile and layering; Crusaders' production compose, hardened image and design tokens; Gaia's
server for MCP from .NET. Carry the drawn design's colours and type into one token layer. Read
Paperclip and record what to copy and avoid.
*Done when:* an empty stack builds, tests and comes up from one command with zero warnings.

**Phase 1 — Four spikes, cheapest risks first.** Each is thrown away after it answers its question.

| Spike | Question | Passes when |
| --- | --- | --- |
| Harness kernel | Can our own loop and edit tool build a real feature on cheaper models? | Measured success rates per tier on a small .NET-and-React task set; a tier is found that passes. |
| Containers | Can .NET build, run, route to, sleep and wake an app on this Mac? | A generated app wakes from sleep in a measured, acceptable time. |
| Cloudflare | Do one wildcard record and one tunnel rule cover everything, and can an outage page be shown? | Both address shapes resolve with free certificates; the outage page appears when the stack is down. |
| OpenRouter | Do routing ceilings, web search and per-call cost reporting work as needed? | Cost per call is known before and after; research can search the web through it. |

*If the harness spike fails on every affordable tier,* stop and bring that to the founder — it is
the one result that would reopen the own-harness decision.

**Phase 2 — The thin slice.** One pass through the whole chain, for FrostAura only:
organisation tree and cascade; owner sign-in with a passkey; credits ledger and model gateway;
harness kernel, tools, permissions, run log, tasks; the factory from research to verdict to plan to
build to evaluation to a private publish; app kit with identity, data, models and telemetry; edge
routing; console home, start, verdict, app and live trace.
*Done when:* one new, real app is described in words and ends up running privately at its address,
built without anyone touching code, with every credit accounted for.

**Phase 3 — The workforce.** Employees and contractors, job descriptions, hire proposals, track
records, curated memory and reviews, reassignment and release; sub-agents and parallel lanes;
estimates scored against actuals; the security reviewer; skills.

**Phase 4 — Platform breadth.** Cascading vault; inbound webhooks and governed outbound calls;
schedules; email; MCP for the control plane and every app; plain-language dashboards; sleep
settings; private, shared and public apps with end-user sign-up; organisation subdomains; version
history and restore; code and data export; technical mode.

**Phase 5 — Many organisations, and money.** God mode, provisioning, manual top-ups, the cascading
overdraft and pause-at-limit, the four roles at every level; backups with one rehearsed restore;
the outage page; the Mac mini set never to sleep.

**Phase 6 — Acceptance and hardening.** FrostAura moved in as tenant zero; Crusaders rebuilt on
Endgame; one invited organisation building and sharing an app. Then one capped hardening phase —
independent review rounds, the number chosen by the founder.

## How the building is done

- **Contracts first.** The interfaces between services and the run-log event shapes are written
  before lanes start, so parallel work cannot collide.
- **Five lanes, disjoint by service:** harness and runner · dock and edge · control-plane domain ·
  console · app kit. Each in its own working copy under `~/src`.
- **Lean checks per lane; full suites once per round; review deferred to Phase 6.**
- **Final testing is a real browser walk** of the running console, alongside end-to-end specs.
- Docs follow the house taxonomy — use cases, architecture, testing — and block features when stale.

## Flags for the founder

1. **Model gateway — write our own, drop LiteLLM.** FLAG. With one upstream and our own harness,
   LiteLLM is a second language and a second database for little gain; the per-app budget features
   Endgame needs are in its paid tier; and reserving credits *before* a call has to be ours anyway.
2. **Email needs a sender.** FLAG. That is a third external service unless Cloudflare's own email
   sending proves usable (unverified) or the existing FrostAura mail server is used.
3. **Telemetry in PostgreSQL first.** A dedicated analytics store adds several services to one
   small machine; move only when volume demands it.
4. **Isolation is container-level on a Mac.** Real per-app virtual machines need Linux. Accepted
   for the invite-only stage; it is the trigger to plan for when leaving the Mac mini.
5. **Licence and visibility of the repository.** FLAG. House default is open source and public.
6. **Docker on the Mac mini.** Whatever is installed stays; its idle-shutdown setting must be off.

## How we will know it works

- Each phase has the "done when" above, checked on the running system, not from a green test run.
- The harness benchmark gives a number per model tier, re-measured on every model change.
- Three acceptance tests from the spec close the first version.
- Every credit spent by an agent is traceable to organisation, division, project, app and employee,
  and estimates are scored against what the work cost.
