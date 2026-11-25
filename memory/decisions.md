---
name: technologies-fa-endgame-decisions
description: "Both governance gates passed 2026-11-24, red lines on four conditions. Founder: own agent harness, only Cloudflare and OpenRouter external, own model gateway in place of LiteLLM, first version is the whole product."
type: decision
last_verified: 2026-11-25
---

# Live decisions

Product decisions are in [`../docs/specs/endgame-spec.md`](../docs/specs/endgame-spec.md), each
with its why. This topic holds the gate results and the decisions that shape the build.

**Red-lines gate — passed on conditions (2026-11-24).** Lines 2 and 3 do not apply. Two were
argued, by direction of effect:
- *Surveillance (line 4).* God mode, default telemetry and the agent trace are operator and owner
  tooling, not a system aimed at watching people. Passed on two conditions, now invariants in
  `CLAUDE.md`: God-mode entry is logged and readable by the organisation's Owner; tenant data is
  never used across organisations or beyond running that tenant's service.
- *Predatory finance (line 1).* The overdraft is debt. Passed on the condition that it carries no
  interest and no fees.
- *Tenants.* A platform can host someone else's red-line product. Condition: no organisation may
  build one; the research stage screens every idea and provisioning screens the organisation.
This was judged by an agent, not the founder. The surveillance reading is the one to overrule if
he sees it differently.

**Belongs-in-FrostAura — passes two tests clearly (2026-11-24).**
1. *Capital:* designed to earn (credits at a margin) and unproven; research found the commercial
   case thin. Not counted as a pass.
2. *Reusable capability:* yes — it becomes the operating layer and host for FrostAura's web products.
3. *Advancement:* weak yes — capability for one person to run many products.
4. *Institution:* yes — tenant zero is FrostAura itself.
5. *Public good:* no.
Not four of five, so not "core". On proven capital alone the test's branch would send it to Labs;
it is placed in Technologies by the routing rule (software product and internal tooling) and the
founder's approved plan. **Its capital claim is falsifiable:** three invited organisations paying
$50 to $150 a month in credits. If that fails, re-score.

**Founder decisions that shape the build (2026-11-24).**
- **Endgame writes its own agent harness.** No outside harness is run. Why: no dependency on, or
  breakage from, someone else's runtime. Cost accepted: owning it, and earning edit and tool-call
  reliability on cheaper models by measurement.
- **Two external services only: Cloudflare and OpenRouter.**
- **Own model gateway, not LiteLLM** — approved with the plan. Why: one upstream, credits must be
  reserved before a call, and LiteLLM's per-app budget features are in its paid tier.
- **The first version is the whole product;** the plan's phases are order, not scope.
- **The repository is public, for now** (founder, 2026-11-24). Why: free CI minutes. He accepts
  the risk of it being cloned before he makes it private later. No licence file is added, because
  a repository meant to go private is not being offered as open source.

**The academy is part of the product (founder, 2026-11-25).** Every flow is documented, scripted
against the demo build, walked in a real browser and published to GitHub Pages, and it must
always be kept current as things change, as thoroughly as the first pass. Why: it is what clients
and FrostAura's own operators learn the product from, and it was built by reading the code flow by
flow — which is also how it found two blockers and about thirty gaps. Rule 14 in `CLAUDE.md`.

