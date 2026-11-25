# FrostAura Endgame — `technologies.fa.endgame`

## What this project is

One place to run every product you own. A single organisation tree — whose permissions, secrets,
budgets, agents and context inherit downward — researches, builds, hosts and operates each
full-stack web app on shared services, for one predictable bill. The first user is the founder,
running the whole FrostAura structure on it; after that, organisations FrostAura provisions for
invited people.

## Architecture & key concepts

- **The cascade** — `Organisation → Division → Project → App`. Permissions, secrets, credit budgets,
  agents and context are all resolved by walking it. Anything that needs "what applies here?" asks
  the cascade resolver; nothing re-implements inheritance.
- **Services:** *Edge* (the only door: routing, wake and sleep), *Control plane* (tree, identity,
  vault, credits, model gateway, scheduler, telemetry intake, MCP gateway, version history),
  *Runner* (hosts the agent harness and factory workflows), *Dock* (the only service that controls
  Docker), *Console* (the React front end), PostgreSQL, an egress proxy, the tunnel and backup.
- **The harness is Endgame's own**, in .NET: an event-sourced loop, tools that execute inside a
  workspace container, a permission check before every tool call, plans as contracts, a persistent
  task graph, sub-agents, compaction, curated memory, skills, hooks, and credits reserved before
  each model call.
- **Workforce:** *employees* (named, lasting, with a job description, track record and curated
  memory) and *contractors* (short-lived sub-agents for bursts).
- **The factory:** research → verdict → placement → plan → design → build → evaluate → security
  review → publish. Stages are deterministic code; agents supply judgement inside them.
- **An app** is one container built on the *app kit* (template plus library), on its own internal
  network, with a database and role of its own on the shared server.

## Stack & repo

Division default, with nothing departed from. Repository: `frostaura/technologies.fa.endgame`.
Development happens in the `~/src/technologies.fa.endgame` clone; the clone in the FrostAura tree
is where context files and `.env` are kept. Sharpened here:

- External services are **two only: Cloudflare and OpenRouter**. A third needs a founder decision.
- No external agent harness, gateway or orchestrator is embedded. Open-source libraries compiled
  into Endgame are fine.
- Generated apps use this same stack, always.

## Conventions & non-obvious rules

These look optional and are not. The first four are the conditions on which Endgame passed the
red-lines gate.

1. **Every God-mode entry into an organisation is logged, and that organisation's Owner can read
   the log.** Operator access is never silent.
2. **Default telemetry is operational and belongs to the app's organisation.** Tenant data is never
   used across organisations, profiled, or put to any purpose beyond running that tenant's service.
3. **Overdraft carries no interest and no fees**, ever.
4. **No organisation may build a red-line product on Endgame.** The factory's research stage
   screens every idea against FrostAura's red lines, and provisioning screens the organisation.
5. **Only Dock touches Docker.** No other service, and no app, is given the socket.
6. **Tools run in the workspace container; the harness runs outside it.** Generated code never
   executes beside the agent's own machinery.
7. **Permission check before every tool call**, with a protected-path floor nothing overrides. An
   agent trusts nothing it reads until that gate has run.
8. **Credits are reserved before a model call, never counted after.** A cap must be exact.
9. **Repair of an agent's own failed work is not billed.**
10. **Go-public is a human act.** No agent may make an app public.
11. **An estimate is shown before work starts**, and is scored against what the work cost.
12. **Normal mode never names infrastructure** — no containers, stacks or repositories in its copy.
13. **One token layer for the look.** No raw colour or size literals outside it.

## Build, test, run

The `Makefile` is the contract: `make up`, `make lint`, `make build`, `make test`. On this Mac,
prefix raw `dotnet` commands with `MSBuildEnableWorkloadResolver=false`, and never use
`dotnet watch`.

## Docs

- `docs/specs/` — upstream input: the idea spec and the build plan. Product decisions live in the
  spec; change them there, with the founder.
- `docs/use-cases/`, `docs/architecture/`, `docs/testing/` — the house taxonomy. Stale docs block
  feature work.
- `docs/flows/` — every flow a person, operator, end user or assistant can follow, read from the
  code; the source for the product documentation and the academy. A change to a screen, an
  endpoint or an assistant tool changes its flow in the same commit.

## Never do here

- Never embed or shell out to an external agent harness.
- Never add an external service beyond Cloudflare and OpenRouter without a founder decision.
- Never give an app or a workspace the Docker socket, host networking or unrestricted egress.
- Never let an agent publish an app publicly, delete data, or exceed a budget without a human.
- Never ship a placeholder: no stub pages, stand-in services or "coming later" copy.
- Never commit a secret, or print a `.env` value — key names only.

## Dependencies on other FrostAura projects

None at runtime. Its acceptance test rebuilds `technologies.crusaders.squash-control-system` as an
Endgame app, and it borrows scaffolding patterns from `labs.fa.reel`,
`technologies.crusaders.squash-control-system` and `technologies.fa.gaia`.

## Skills

- Holding the mandated stack line and its baseline (for example `fa-engineering-default-tech-stack`).
- The .NET API lint, test and command surface (for example `fa-engineering-stack-dotnet-api`).
- The web front-end lint, test and build surface (for example `fa-engineering-stack-web-ts`).
- Composing shadcn/ui with semantic tokens (for example `fa-engineering-ui`).
- The compose-first local stack (for example `fa-engineering-containerization`).
- Keeping architecture docs aligned with the system (for example `fa-engineering-architecture`).
- Activating the deploy chain (for example `fa-engineering-deploy-chain`).

No local skill set.

## Upkeep

This file, `MEMORY.md`, its `memory/` topic store, and the skills that fire at this level are kept
current **as changes land**, not in a later cleanup pass. `MEMORY.md` is required here exactly as
this file is: an instruction file with no `MEMORY.md` beside it is a defect, not a shortcut — the
rules are stated and reality is left unstated, so the next agent infers status instead of reading
it. Both files, or neither.

- **Memory — always.** Update the topic files at the end of any session that shipped, decided,
  discovered, abandoned or unblocked something; re-cut the `description:` of any topic whose signal
  moved, then regenerate `MEMORY.md` from the topic files rather than editing it —
  `python3 .claude/scripts/audit-tree.py --no-git --fix-index --scope Technologies/projects/technologies.fa.endgame`
  from the tree root; restamp `last_verified:` only for what you actually re-inspected. Record
  decisions *with their why* — a decision without its rationale is reversed by the next agent, who
  sees only its cost.
- **This file — only when a rule changed.** A new convention, command or invariant earns an edit.
  A status change does not; it belongs in the memory store.
- **Skills — when *how* the work is done changed.** Fix or delete a skill whose commands or
  thresholds no longer exist; a stale skill is worse than a missing one because it fires with
  authority. A procedure that would be correct in a repository with nothing to do with this tree
  belongs upstream in a plugin, never forked into this tree.
- **Scratch — always.** Empty `.tmp/` before the session ends, promoting anything that still
  mattered first.

None of these four are assessed by search. Read the scope's files end to end before changing any of
them. Drift is not caused by neglect over months; it is caused by good sessions that ended without
a close-out.
