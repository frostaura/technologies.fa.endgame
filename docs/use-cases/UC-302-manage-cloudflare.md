# UC-302 — Keep Cloudflare matching what Endgame needs

| Field | Value |
| --- | --- |
| **ID** | UC-302 |
| **Title** | Plan, then apply, the DNS records, tunnel ingress and outage page Endgame needs; refuse names the zone already uses |
| **Primary actor** | The founder, as the host's operator (plan and apply) · the control plane (reserved names) · a visitor (the outage page) |
| **Scope** | Ops (`Endgame.Ops`), Cloudflare (DNS, tunnel configuration, Workers and routes), the outage Worker |
| **Cascade level** | None: one zone and one tunnel for the whole platform; organisation subdomains need no per-organisation change |
| **Status** | Built (tested against a local fake of Cloudflare's API; never applied to the live account) |

## Goal

Both address shapes work for every organisation without a DNS change per organisation; a visitor
reaching Endgame while the machine is down sees a plain "temporarily unavailable" page instead of a
Cloudflare error; and nothing else on the founder's zone is ever changed.

## Preconditions

- A Cloudflare API token with exactly the four permissions in ARCH-007, and the account, zone, tunnel,
  zone name and console host configured. Without a token the service is idle and says so.

## Main flow

1. The operator runs `make ops-cloudflare-plan`. Ops reads the zone's records, the Worker routes, the
   tunnel's configuration and the outage Worker's settings, and prints each change it would make —
   create, update, delete, keep or conflict — with why. Nothing is changed.
2. The operator runs `make ops-cloudflare-apply CONFIRM=yes`. Ops plans again, refuses if there is any
   conflict, otherwise uploads the Worker if its source changed, sets its routes and an excluding route
   for each of the zone's other web hosts, sets the tunnel's ingress, and creates or corrects its two
   DNS records. It reads everything back and reports whether the account is now in sync.
3. When the control plane creates an organisation it asks `GET /internal/ops/reserved-hosts` and
   refuses a name the zone already uses.
4. When the origin is unreachable, a visitor's browser gets the outage page from Cloudflare's edge.

## Alternate and failure flows

- **A1 — A record not created by Endgame sits where Endgame needs one** (the dashboard's own "public
  hostname" record, say). The plan shows a conflict saying how to adopt or remove it; apply refuses and
  changes nothing.
- **A2 — Another Worker holds an Endgame route pattern.** Conflict; apply refuses.
- **A3 — Apply without `CONFIRM=yes` / `?confirm=true`.** Refused before any call.
- **A4 — No token, or half configured.** Plan and apply refuse naming the missing keys; reserved hosts
  answer `complete: false` with only the fixed reservations; `/health` says `idle` or `misconfigured`.
- **A5 — Cloudflare refuses a call.** Its error code and message are passed on (`502 cloudflare_error`).
- **A6 — The console host is two labels under the zone.** Refused: the free certificate covers one level.
- **A7 — The origin answers 500 or 503.** Passed through: those are Endgame's or the app's own pages.

## Postconditions

- The account is in sync: a second plan is all `keep`, a second apply makes no request that changes anything.
- Every record Endgame created carries `endgame-managed` in its comment; every other record is as it was.

## Rules this use case must honour

- Only Cloudflare and OpenRouter are external: this is the Cloudflare half, through its documented API only.
- Normal mode never names infrastructure: the outage page says Endgame cannot be reached, nothing more.
- Never change what Endgame did not create.

## Acceptance

- Apply on a fresh account then apply again: the second applies nothing and makes no mutating request.
- No request modifies or deletes a record without the mark; an untagged record at the console host is a
  conflict, and apply refuses with the record unchanged.
- Other hostnames' tunnel rules survive in order; the catch-all is last and 404.
- The Worker is uploaded only when its source changed.
- The outage Worker replaces 502, 504, 52x and 530 and network failures, and passes through everything else.

## Links

- Spec: *Addresses and hosting* · [`ARCH-007`](../architecture/ARCH-007-cloudflare-and-backups.md) · [`TEST-301`](../testing/TEST-301-ops.md)
