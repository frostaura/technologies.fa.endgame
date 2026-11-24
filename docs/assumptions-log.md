# Assumptions log — for the founder's review

Every choice an agent made on the founder's behalf while he was away, newest last. Each entry says
what was assumed, why, and how to reverse it. Product decisions he made himself are in
[`specs/endgame-spec.md`](specs/endgame-spec.md), not here.

| # | Assumption | Why | To reverse |
| --- | --- | --- | --- |
| 1 | **The red-lines gate passes, on four conditions.** God mode, telemetry and the agent trace were read as operator and owner tooling, not surveillance. | Direction of effect: none of it exists to watch people. The conditions (logged and Owner-visible God-mode entry; no cross-tenant use of data; no overdraft fees; no red-line products hosted) are now rules in `CLAUDE.md`. | A red line is the founder's call. If he reads God mode differently, change the design before Phase 5 builds it. |
| 2 | **Endgame is placed in Technologies**, although on proven capital alone the belongs test would send it to Labs. | The routing rule (software product, internal tooling) and the approved plan both name Technologies. | Rename the project to `labs.fa.endgame` in the repository, tree and `~/src`, and move its registry rows. |
| 3 | **No licence file.** | He made the repository public for free CI and said it will go private later, so it is not being offered as open source. | Add a licence. |
| 4 | **The mark is an "E" drawn as the cascade** — one trunk, three shortening branches ending in nodes, the last one lit — with a 24-icon set coloured by what a thing is. | He asked for iconography; this ties the icon to the product's one idea and stays legible at 16 pixels. | Redraw; every use reads from `src/frontend/public/brand/`. |
| 5 | **Development uses the founder's existing OpenRouter key**, copied by name from another FrostAura project's `.env` into Endgame's untracked `.env`. Its value was never printed. | The harness cannot be built or measured without model calls, and OpenRouter is one of his two named external services. Spend is kept low: cheap models by default, a hard cap in code on every benchmark run. | Put a separate key in `.env`; rotate the shared one if he prefers they not mix. |
| 6 | **Nothing is changed in the live Cloudflare account.** The Cloudflare integration is built and tested against a local fake; the wildcard record, tunnel route and outage page are not applied. | No Cloudflare credential exists on this machine, and a wildcard record on `frostaura.net` changes how his whole domain resolves — not something to do unattended. | Supply a scoped token and say go; the plan's Cloudflare spike then runs for real. |
| 7 | **Email is built behind one interface and sent to a local mail catcher in development.** No mail leaves the machine. | Who sends production email is an open founder question; real sends from an unattended run risk his sending reputation. | Point the interface at the chosen sender. |
| 8 | **This laptop is the host.** The stack runs on its Docker. | **Confirmed by the founder on 2026-11-24:** "for all intents and purposes this is the mac mini", and all Docker work on it is allowed. | Deploy elsewhere with the production compose file. |
| 9 | **Model spend caps for the spikes: US$12 for the harness benchmark and US$2 for the OpenRouter capability checks**, each enforced by the spike itself before every call. | Enough to measure four or five model tiers on six tasks three times; small enough to be an acceptable surprise. | Lower the caps in the spike briefs, or stop the runs. |

## Founder replies

- **2026-11-24** — shown the held items and the two assumptions flagged for him (use of his
  OpenRouter key; the red-lines reading of God mode), he replied "You assume correct". Entries 1
  and 5 are treated as confirmed. Entry 8 was confirmed in the same message.
