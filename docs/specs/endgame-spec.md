# FrostAura Endgame — idea spec

> **The product spec for `technologies.fa.endgame`.** Every product decision lives here, each with
> its why; change one only with the founder. Whether anything is built is in `MEMORY.md`.
> How it gets built: [`endgame-build-plan.md`](endgame-build-plan.md).
> Choices marked *delegated* were made by Claude when the founder said to make reasonable ones.

## One line

One place to run every product you own. A single organisation tree — whose permissions, secrets,
budgets, agents and context inherit downward — researches, builds, hosts and operates each app on
shared services, for one predictable bill.

## What it leads with

Market research (verdict below) found most of Endgame's parts already on sale. So it leads with the
four things nobody combines, in this order:

1. **The cascade** — the operating layer under a portfolio of apps.
2. **Predictable cost** — an estimate before work starts, caps at every level, no charge for an
   agent's own mistakes.
3. **A research verdict that can stop a build.**
4. **Uniform services under every app** — one identity, one vault, an MCP server each, by default.

The agent workforce is how the work gets done. It stays in full, but it is not the pitch:
"AI employees" is a crowded and divisive claim, and the cascade is the part others lack.

## Who it is for

- **First user: the founder, running the whole FrostAura structure on it.** FrostAura is tenant zero.
- After that: organisations provisioned by FrostAura for invited people. There is no self-serve
  sign-up in the first version.
- **The first outside organisations** (*delegated*): three people the founder knows personally who
  each already run two or more live web products — the segment the research found most likely to
  pay. Who they are is the founder's to name. None is invited until FrostAura itself and the
  Crusaders rebuild are running on Endgame.
- **What they pay for** (*delegated*): credits, from the first day, by manual top-up — no free
  tier and no subscription. Credits are priced at what the work actually costs (models and
  hosting) plus one fixed margin, so the bill is explainable line by line. A typical small
  portfolio should land between $50 and $150 a month, the range the research found such people
  already spend; if it cannot, the margin or the product is wrong.

## Lineage

Endgame is the successor in spirit to FrostAura Startup ("Startup on steroids"). **It reuses none of
it** — no code, no design, no concepts carried by default. It is imagined from zero. It also does
not reuse Gaia's agent roles; the workforce concept below is new.

## The spine — one cascade

Everything in Endgame hangs off one tree and inherits downward:

```
Organisation → Division → Project → App
```

The same cascade carries **permissions, secrets, credit budgets, agents and context**. Something
set at a level applies to everything beneath it unless a lower level narrows or overrides it. One
rule to learn, used everywhere — this is what keeps cognitive load low.

## Three layers

1. **Organisation layer** — the tree, a living ontology of it, the org chart, and the agent
   workforce. The cascade is the differentiator — competitors stop at a flat workspace of apps.
2. **Factory** — the lifecycle that takes an idea to a running product.
3. **Platform** — the runtime that hosts the apps and the shared services they are built on.

Endgame itself is the **control plane**: it provisions, manages and observes all three.

## Layer 1 — the organisation and its workforce

**Onboarding.** The user names the parent organisation and describes a product idea. The AI
researches the market with them, refines the idea, then proposes a division for it to live in and a
project name. Divisions and projects can also be created directly. The system can suggest new
product ideas from what the organisation already holds.

**Ontology.** Every step extends a graph of the organisation: entities, what depends on what, who
(human or agent) is responsible for what, and how data flows. It is viewable as an org chart and
as a data-flow view.

**Workforce — employees and contractors, hired on demand** (founder decision). There is no fixed
roster of agent roles. The workforce is created as the organisation's needs appear, in two kinds:

- **Employees** do standing work. Each is a named individual with a role, a job description
  (mandate, scope in the cascade, tools and services it may use, credit budget, model tier), a
  place on the org chart, a track record — what it produced, what it cost, how often its work was
  accepted or sent back — and a memory the user can open and read.
- **Contractors** do bursts. When a need is temporary or wide — a dozen competitors researched at
  once, one large parallel build — short-lived contractors are briefed by the relevant employee, do
  the job, hand what they learned back to that employee, and are gone. Nothing lingers on the org
  chart or the bill.

**An employee's memory is curated, not accumulated.** After each task the employee records what it
learned about the organisation; a periodic performance review consolidates that memory, prunes what
is stale and corrects bad habits. Each task runs fresh against the curated memory, so quality does
not drift as history grows.

**The org chart changes as the organisation does:**

- *Hiring* is triggered by the ontology — a new division, a project entering a new stage, a
  recurring job.
- *Promotion* — a contractor role that keeps recurring is proposed as a permanent hire.
- *Reassignment* — an employee can move between divisions and takes its memory along.
- *Release* — an employee with nothing to do is flagged and let go; its memory is archived, so a
  rehire is not a cold start. An idle workforce is never paid for.

In auto-mode all of this happens within budget on its own; with a checkpoint set, it waits for
sign-off.

Everything an agent does is traceable: live activity, logs, data flow, cost, and versioned output.
The user can watch or redirect any agent at any time.

One standing hire exists in every organisation: a **light security reviewer** that checks apps for
misuse of the platform services (secrets, auth, data, LLM, outbound calls).

**Agent harness — Endgame's own** (founder decision, reversing the earlier delegated choice). No
external harness is embedded: the agent loop, planning, task tracking, sub-agents, tools,
permissions, memory, compaction and checkpoints are written as part of Endgame, in .NET. Outside
harnesses are studied for their patterns, never run. What that costs: the harness becomes a part
of the product to maintain, and the hard-won part of existing ones — reliable file edits and tool
calls on cheaper models — has to be earned here by measurement. The trust lesson from the killed
Harness project binds from day one: a permission gate and a protected-path floor before an agent
trusts anything it reads.

**External services are two, and only two** (founder decision): Cloudflare and OpenRouter.
Everything else runs inside the stack. Open-source libraries compiled into Endgame are not
external services.

**Prior art to study first.** Paperclip, an open-source project, already has an agent org chart,
hiring by approval, and budgets at company, agent and project level. It is studied before this
layer is designed — to learn from and to avoid rebuilding what exists. ("Nothing reused" refers to
FrostAura's own earlier products.)

## Layer 2 — the factory

The full lifecycle, in an order that makes sense, with the user able to step in and change anything
at any point and the system adapting downstream:

research and gap analysis → idea refinement → placement (division, name) → requirements → design
(including icons and brand assets) → build → test → security review → publish → telemetry → iterate.

**Research ends in a verdict the owner can overrule** (founder decision): build, change, or do not
build — with the evidence: who already does this, what gap is left, who would want it. A "do not
build" pauses auto-mode and asks the owner; one action overrules it and the project records that
it was overruled. A system that agrees with every idea only builds unwanted products faster.

**The verdict is harsh by design.** Idea validators are widely reported as flattering, so this one
argues the case against the idea first, must name the existing products it found, and counts
missing evidence of demand as a reason not to build. Endgame **measures how often it says no** and
how overruled verdicts turned out, per organisation, and shows the owner both — a verdict that
never says no is treated as a fault in the product.

The user states constraints in plain language. Two modes: **normal** (no mention of frontends,
backends or infrastructure) and **technical** (everything exposed).

**Autonomy — auto-mode by default, human-in-the-loop by opt-in** (founder decision). Left alone, the
workforce runs the lifecycle end to end. The user can switch on checkpoints where they want a say,
and each stage can carry a **rule set** — what must be true before the stage is done, what needs
sign-off, what the agents may not do. Checkpoints and rule sets follow the cascade: set once for an
organisation, narrowed for a division or project. The credit budget is the limit that is always on.

**Code lives inside Endgame, and can always leave** (founder decision, revised after the market
research). Endgame keeps each app's full version history itself; every change is attributable to
the human or agent that made it, and any version can be restored. No outside account is needed.
An Owner can download any app — code, version history and data — at any time, at no cost. An
exported app expects the platform's services and needs its own replacements to run elsewhere, but
it is the organisation's to take. **Continuous sync to the organisation's own GitHub is a later,
paid feature** — the convenience is what is sold, never the way out.

## Layer 3 — the platform

**Every app is a full-stack web app in its own container — invisibly** (founder decision). The
control plane builds, runs, routes to and retires a container per app; the user never sees or
manages one, in normal mode or otherwise unless they ask. The container is the isolation unit: one
app's fault or overuse is fenced from its neighbours.

**Apps are still built against the platform SDK**, not against a blank machine. Identity, data,
secrets, LLM, webhooks, schedules, email and telemetry come from the platform and are not
re-invented per app. That is what keeps the generation target narrow, lets the MCP surface be
derived, and stops every app carrying its own database server — apps get a database on the shared
platform store, not a database container each.

**One fixed stack for every generated app** (founder decision): FrostAura's mandated stack — .NET
with PostgreSQL behind, React with Tailwind and shadcn/ui in front. The SDK is written once, the
agents and the security reviewer specialise in one thing, and every app behaves like its siblings.
The stack is invisible in normal mode.

Native apps and store publishing are out of scope. Games are in scope as web apps.

**Apps sleep when idle and wake on request, by default** (founder decision). Anyone with rights
over an app can change that — pin it always-on, or tune how long it waits before sleeping — and
the setting follows the cascade. Sleeping apps cost almost nothing to host, so this is the
customer's main lever on their own bill; always-on costs more credits and buys an instant first hit.

Cost to design for: the control plane gains control of Docker on the host, and every awake app
takes real memory on one Mac mini.

**Apps are private by default** (founder decision). A new app is visible only to organisation
members with rights over it. Someone with access shares it with chosen people by email address;
each of them registers with the organisation's identity system before they can open it.
**An organisation can also make an app public — open to anyone, no login** (founder decision).
That is the organisation's call, made by a member with rights over the app. So an app has three
settings: private, shared with registered people, public.

**Shared services** every app can use, all provisioned and managed by the control plane:

| Service | Notes |
| --- | --- |
| Identity | Branded per organisation. Two populations: **members**, who hold one of four roles (below), and **app end users**, who register to use an app and have no role in the organisation. |
| Data | Per-app storage; queryable for dashboards. |
| Secrets vault | Set at any cascade level, inherited downward, usable by apps and agents. |
| LLM | Apps call models through the platform (LiteLLM as the gateway: a key per organisation or app, budgets, spend logs). |
| Webhooks in / calls out | Inbound endpoints (e.g. a device or a health-metrics feed posting data) and outbound calls using vault secrets. |
| Scheduled jobs | Recurring work. |
| Email | Transactional mail from apps. |
| Telemetry | Collected by default for every app with no work by its author — **health, traffic, errors, latency, resource use, credit burn** — plus whatever the app records itself; **natural-language dashboards** on top. |
| MCP | **On by default.** The control plane and every app expose an MCP surface, derived from what the app does through the SDK. Anything possible in the UI is possible over MCP. |

Payments for app end users are **not** in the first version.

**Four fixed member roles** (founder decision), each grantable at any level of the cascade and
inherited downward, so one person can be a Builder in one division and a Viewer elsewhere:

| Role | May |
| --- | --- |
| Owner | Everything, including credits, the overdraft limit, managing Admins and deleting the organisation. One per organisation at first — the person it was provisioned for. |
| Admin | Manage people, secrets, sharing and public/private, budgets and rule sets within scope. |
| Builder | Create and change projects and apps, direct employees, spend credits within budget. |
| Viewer | See everything in scope — org chart, dashboards, apps — and change nothing. |

## Model routing

Models are routed per task, weighing cost against capability — Jev is the intended router. Each
class of task carries a **price ceiling**, because an unconstrained router has sent a one-character
fix to a frontier model before. Cheap models take chat, classification and summarising; stronger
models take architecture and code.

## Credits

**Credits meter both AI work and hosting** (founder decision). Every agent action and LLM call, and
every app's running cost — storage, traffic, compute, and a container's reserved resources — is
traced to an organisation, division, project, app and agent, and charged in credits. Budgets
cascade.

**Cost is predictable — a headline promise** (founder decision, from the market research;
unpredictable credit bills are the loudest complaint about every competitor):

- **An estimate before work starts.** Every piece of agent work shows its expected credit cost
  first; in auto-mode, work whose estimate would break a budget does not begin.
- **Caps at every level** — organisation, division, project, app and employee — inherited down the
  cascade, with the spend against each always visible.
- **No charge for an agent repairing its own failure.** When work is sent back because the agent
  got it wrong, the repair is not billed to the organisation.
- **Estimates are scored against actuals**, and the gap is shown, so the estimate can be trusted.

**Overdraft, for customer goodwill** (founder decision). Reaching zero stops nothing. An
organisation may run a negative balance down to a limit: a FrostAura admin sets the deepest
overdraft allowed for each organisation, and the organisation's admin may set a tighter one of
their own, never a deeper one. The limit follows the cascade, so a division or project can be
held to less. The next top-up settles the debt first. **At the limit** (founder decision): employees stop
working and apps pause behind a holding page; all data, code and employee memory are kept
untouched, and a top-up restores everything at once. Owners are warned at thresholds on the way
down. Nothing is deleted for non-payment unless a FrostAura admin removes the organisation.

## God mode

Accounts on FrostAura email addresses can list and enter every organisation and assign credit
top-ups. Entry into another organisation is logged.

## Addresses and hosting

- **Two address shapes, both supported** (founder decision): the path form
  `endgame.frostaura.net/<org>/<division>/<project>` and the organisation subdomain
  `<org>.frostaura.net`. Both are covered by Cloudflare's free certificate; one wildcard record
  sends every organisation subdomain to the Endgame gateway, so creating or removing an
  organisation needs no DNS change. Organisation names that collide with FrostAura's own
  subdomains are reserved. **Apps are reachable at both shapes** (founder decision).
- **Cloudflare is managed programmatically by the control plane** (founder decision): DNS records,
  tunnel routes and anything else Endgame needs are created and removed through Cloudflare's API,
  never by hand, with the API credential held in the vault.
- **Backups go to Cloudflare storage** (founder decision): a nightly copy of everything — data, code
  history, employee memory — encrypted before upload with the key held in the vault, staying
  inside the free allowance for as long as it fits.
- Runs first on the founder's Mac mini, fully Dockerised, exposed by Cloudflare tunnel.
- **Outages** (*delegated*). The Mac mini is set never to sleep and to restart itself after a
  power cut, and every container restarts on its own. When the machine cannot be reached, visitors
  get a plain "temporarily unavailable" page served from Cloudflare, not a browser error, and the
  founder is alerted. **No uptime promise is made in the first version** — invited organisations
  are told plainly that it runs on one machine. With nightly backups, the most that can be lost is
  a day. Because everything is Dockerised, recovery means restoring the last backup onto any other
  Docker host; **that restore is rehearsed once, end to end, before the first outside organisation
  is invited.** Endgame moves off the Mac mini when either an outside organisation runs a public
  app that must stay up, or the machine's memory is regularly more than about two-thirds used.
- **No paid certificates.** Cloudflare's free certificate covers one subdomain level only, which
  is why per-organisation subdomains under `endgame.frostaura.net` were dropped.
- **Known cost of this choice:** on the path form, every organisation's apps and the console
  share one browser origin, so the browser itself separates nothing there — isolation rests
  entirely on the platform (server-side checks on every call, and how apps are framed). The same
  app at its two addresses also has two separate logins and stored states unless the platform
  bridges them. Acceptable while the only tenants are FrostAura and invited people; to be
  revisited before strangers are let in.

## Experience

**The home screen is the living org chart** (founder decision). The user lands on their organisation
as a map — divisions, projects, apps, and the employees working on each — with live status, spend
and health on every node. Selecting a node opens it. One conversation is always docked alongside
and is scoped to the selection: the whole organisation, a division, an app, or a single employee.
The cascade is the navigation, so structure, permissions and "where am I" are one mental model.

Minimal, light, clean — black on white, one accent. Low cognitive load by default, with advanced
detail available on request and never in the way.

## The first version

**The first version is the whole product** (founder decision) — the organisation layer, the factory
and the platform together, not one of them ahead of the others. Nothing in this spec is deferred
except what it names as later: native apps, a payment gateway, payments for app end users, GitHub
sync.

**Build order inside it** (Claude's proposal, not a scope cut): the first milestone is one thin
pass through the entire chain for FrostAura alone — an idea described, researched, placed, built
and reviewed by hired employees, and running privately at its address with identity, data, an LLM
call, telemetry, the org chart and credit tracing all real. Everything else is then widened from
a chain already known to hold. Startup and Harness both showed that build speed is not the risk;
finding out late that the pieces do not join is.

## Acceptance test

The first version is done when all three are true:

1. **FrostAura runs on Endgame as tenant zero** — its divisions, its web projects, its workforce.
2. **Crusaders Squash Control System is rebuilt on it as an app**: bookings, members as app end
   users, the court hardware calling an inbound endpoint, email, MCP.
3. **One invited organisation** is provisioned from God mode, topped up by hand, and builds and
   shares an app of its own.

## Market research verdict — change

Five independent researchers swept the market on 2026-11-24 (app builders, AI-workforce products,
hosting platforms, research and portfolio tools, and demand). **Verdict: build, but change what it
leads with.** Nothing found sells the whole concept; most of its parts are already sold.

**Already commodity — not a reason to buy.** Everything inside one hosted app (hosting, database,
login, secrets, scheduled jobs, built-in AI, analytics, email, one credit balance) from Lovable,
Replit, Base44, Bolt and others. A control-plane MCP server. "AI employees" with names, roles and
budgets (Cofounder 2, Polsia, CellCog, Sintra). An agent org chart with hiring by approval and
company / agent / project budgets — **Paperclip does this in open source**. Research reports and
go / no-go scores. Research feeding a build (Rocket.new, Atoms).

**The claim this spec rested on was half wrong.** "App builders have no organisation layer" holds;
"nobody sells an organisation layer" does not.

**What nobody combines** (each researcher reached this independently):
1. A cascade deeper than a flat workspace — a division layer, with permissions, secrets, budgets,
   agents and context all inheriting downward.
2. Research whose verdict actually stops or redirects the build. Tools that give verdicts do not
   build; tools that build give "signals, not verdicts". Validators are widely reported as flattering.
3. Every app on the platform's own uniform services, with an MCP server per app by default and one
   end-user identity across the portfolio.
4. New ideas suggested from the user's own portfolio.

**How defensible:** narrow. These are structural, and small for a funded incumbent to add; Lovable
ships weekly in this direction. It is a lead, not a moat.

**Demand:** moderate for a consolidated, cost-predictable operating layer under a small portfolio
of apps; weak for the full "holding company in a box" and for the AI-employee framing. People who
run several products alone are few, spend roughly $50–400 a month in total, and their loudest
complaints are unpredictable credit bills, credits burned on fixes that break again, maintenance,
and insecure generated apps. Confidence medium-low: most figures are vendors' own.

**Evidence that changed a decision:** the market competes on exportable code, and a platform that
failed in 2025 left customers unable to reach theirs — so code export was opened up (see *the
factory*).

**Evidence still standing against a decision:** containers on one shared machine are weak
isolation for generated code; the strongest reference design found treats such code as untrusted
and controls its outbound traffic. Accepted while tenants are invited; to be revisited with the
shared-origin question before strangers are let in.

**Five changes followed, all accepted by the founder** and written into the sections above: lead
with the cascade; let organisations take their code out; make cost predictability a headline; make
the verdict harsh and measured; study Paperclip before designing the organisation layer.

## Decisions so far

| Decision | Why |
| --- | --- |
| Nothing reused from Startup or Gaia | Founder: imagine it new. |
| A container per app, invisible to the user, built against the platform SDK | Real isolation between apps; the SDK keeps the generation target narrow and services shared. Supersedes the earlier "applets, not containers". |
| Full-stack web apps only; native apps do not appear at all | The app-within-an-app model fits the web; hosting comes included. A project in Endgame is always something Endgame runs. |
| Two address shapes — path form and organisation subdomain — apps at both | No paid certificate, no DNS work per organisation; the shared browser origin on the path form is accepted while tenants are invite-only. |
| Invite-only, FrostAura-provisioned organisations | Removes the abuse problem of hosting strangers' apps for now. |
| Manual credit top-ups, no gateway | No billing surface until there is someone to bill. |
| MCP by default everywhere | One capability, usable by people and agents alike. |
| One fixed stack for generated apps | One SDK, one thing for agents and review to be good at, uniform apps. |
| Apps sleep when idle by default, configurable | Fits many apps on one machine and gives the customer a lever on cost. |
| Credits meter AI and hosting; overdraft to a cascading limit | A real cost model, with goodwill instead of a hard stop at zero. |
| Auto-mode by default, checkpoints and stage rule sets by opt-in | Low cognitive load, with control where the user asks for it. |
| Research ends in an overrulable verdict | Research that cannot say no is decoration; the owner still decides. |
| Code and data exportable at any time; GitHub sync later and paid | Buyers avoid platforms they cannot leave; the paid feature sells convenience, not the exit. Reverses the earlier data-only export. |
| Lead with the cascade, not the workforce | The research found "AI employees" crowded and divisive, and the inheriting cascade absent everywhere. |
| Predictable cost as a headline: estimates first, caps everywhere, no charge for an agent's own repairs | Answers the loudest complaint about every competitor. |
| A harsh verdict, with its "no" rate measured | Validators flatter; one that never refuses is worthless. |
| Employees with curated memory, plus contractors | The feel of a real staff without quality drift or an idle payroll. |
| First outside orgs: three known operators of 2+ live products, paying by credits at cost plus a fixed margin | *Delegated.* The likeliest payers per the research; an explainable bill. |
| One machine, no uptime promise, rehearsed restore, stated triggers for moving off it | *Delegated.* Honest about a Mac mini; a day's loss at most. |
| Endgame writes its own agent harness; only Cloudflare and OpenRouter are external | Founder decision. No outside runtime to depend on or be broken by; the cost is owning it. |
| Routed models with price ceilings | Quality of generated apps is the product; cost is controlled per task. |

## Open questions

Held in the project's memory store — [`../../memory/questions.md`](../../memory/questions.md).
