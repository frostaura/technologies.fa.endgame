# ARCH-007 — Cloudflare and backups: the ops service

| Field | Value |
| --- | --- |
| **ID** | ARCH-007 |
| **Title** | Cloudflare management and backups |
| **Status** | Current — built and tested against a local fake of Cloudflare's API and a local S3-compatible server; **nothing has been applied to a real Cloudflare account or uploaded to R2** (assumptions log, entry 6) |
| **Covers** | `src/backend/Endgame.Ops`, `src/backend/Endgame.Ops.Tests`, `src/ops/` (the outage Worker and the service's Dockerfile), the `ops` service in both compose files, the `backup`, `restore` and `ops-*` Makefile targets |

## Context

The spec ("Addresses and hosting") asks for three things this service owns:

- **Cloudflare managed programmatically**: one wildcard record sends every organisation subdomain
  to the tunnel, so creating an organisation needs no DNS change; organisation names that collide
  with FrostAura's own subdomains are reserved; tunnel routes are set through the API, never by hand.
- **An outage page served from Cloudflare** when the machine cannot be reached.
- **A nightly copy of everything, encrypted before upload, to Cloudflare storage**, inside the free
  allowance while it fits, with **one rehearsed restore** onto an empty Docker host.

Cloudflare is one of Endgame's two external services. Its zone (`frostaura.net`) also serves
sites that are not Endgame's, so the hardest constraint is negative: **never change anything
Endgame did not create.**

## Components and boundaries

| Component | Owns | Never |
| --- | --- | --- |
| `Endgame.Ops` (service `ops`) | The Cloudflare client and reconciler; the reserved-hosts read; the backup and restore engine; the nightly timer. ASP.NET Core minimal host with `/health` and `/internal/ops/*`, and the same binary as a command line (`/app/Endgame.Ops <command>`). | Touch Docker (it has no socket and no Docker client — `ArchitectureTests`), hold the OpenRouter key, or change Cloudflare outside an explicit apply. |
| The outage Worker (`src/ops/outage-worker/worker.js`) | Standing in front of the console host and every organisation subdomain at Cloudflare's edge. Plain JavaScript, no build step, deployed as written (embedded in `Endgame.Ops`). | Change what a healthy origin answers. |
| The image (`src/ops/Dockerfile`) | Alpine 3.22 with `postgresql16-client` (pg_dump **16.16**, the server's version) and .NET published self-contained for musl, running as uid 1654 like every Endgame service. | Run as root. |

Trust boundaries: the internal API requires the service token (ARCH-004). Cloudflare is reached
only with a scoped API token, only from this service. Restore exists **only on the command line**
(`make restore`), never on the HTTP API: it is an operator's act on the host, not something another
service can trigger.

Volumes: `ops` mounts `dock_data` at `/data/dock` (the app repositories; read for a backup, written
by a restore while Dock is stopped) and `${ENDGAME_BACKUP_DIR:-backup}` at `/backups` (local
archives and the spool directory `/backups/.work`). There is no uploaded-files volume in the stack
today; `Ops__Backup__UploadsDirectory` adds one to the archive the day there is.

## Cloudflare: desired state

Given a zone (`ENDGAME_ZONE`, e.g. `frostaura.net`), a tunnel (`CLOUDFLARE_TUNNEL_ID`) and the
console host (`ENDGAME_CONSOLE_HOST`, e.g. `endgame.frostaura.net` — it must be **one label directly
under the zone**, because the free certificate covers one level only; anything deeper is refused
before a call is made):

| Thing | Desired | Ownership rule |
| --- | --- | --- |
| DNS | `CNAME <console host> → <tunnel id>.cfargotunnel.com`, proxied, TTL auto; `CNAME *.<zone> → <tunnel id>.cfargotunnel.com`, proxied, TTL auto. | Endgame's records carry a comment starting `endgame-managed` (`endgame-managed: console host`, `endgame-managed: organisation subdomains`). Comments exist on every plan (Free: 100 characters); tags do not exist on Free, so they are not used. A record **without** the mark is never modified or deleted. If one sits where Endgame needs a record, the plan shows a **conflict** and apply refuses. A managed record Endgame no longer needs is deleted. |
| Tunnel ingress (remotely managed) | Other hostnames' rules kept, in their order and with their `originRequest`; then the console host and `*.<zone>` → `http://edge:8080`; then a catch-all `http_status:404`. Other keys of `config` (`warp-routing`, tunnel-wide `originRequest`) are sent back unchanged. | The two Endgame hostnames and the catch-all are Endgame's; the plan says what the catch-all was if it changes. |
| Worker `endgame-outage` | The embedded source, with a plain-text binding `ENDGAME_SOURCE_SHA256` holding its hash. Uploaded only when the deployed hash differs. | — |
| Worker routes | `<console host>/*` and `*.<zone>/*` → `endgame-outage`; and **a route with no Worker** for every other web host on the zone (each non-Endgame A, AAAA or CNAME name), which negates the wildcard route there — so the outage Worker never runs in front of a site that is not Endgame's and never spends its request allowance on one. | Routes naming `endgame-outage` are Endgame's. Another Worker's route on an Endgame pattern is a conflict. A Worker-less route Endgame did not ask for is left alone (it cannot be told apart from one somebody else made); one Endgame made for a host that later disappears is therefore never removed automatically. |

Order of apply: the Worker, its routes, the tunnel's ingress, then DNS — a name resolves only once
the tunnel knows where to send it. `apply` computes a fresh plan, **refuses if it has any conflict**
(nothing is changed), executes it, then reads the account back and reports whether it is in sync. A
second apply is a no-op: zero mutating requests (`ReconcilerTests`).

### What the outage Worker does

It forwards every request unchanged and returns the origin's answer, except when the origin cannot
be reached: a network failure, `502` or `504` (cloudflared up, Edge not answering), or Cloudflare's
origin errors `520`–`527` and `530` (a tunnel with no connector, error 1033). Then a browser
navigation (`GET`/`HEAD` accepting `text/html`) gets a self-contained, branded page — "Endgame is
temporarily unavailable … Nothing you have made has been lost" — with `503`, `Retry-After: 120` and
`Cache-Control: no-store`; anything else gets a one-line plain-text `503`. **`500`, `501` and `503`
pass through**: Edge and apps send those deliberately with bodies of their own (a paused app's
holding page is Edge's own `503`). The copy names no infrastructure (`CLAUDE.md` rule 12).

### Reserved organisation names

`GET /internal/ops/reserved-hosts` reads the zone's records (cached `ReservedCacheSeconds`, 300) and
returns every label directly under the zone that a non-Endgame record uses — including the label a
deeper record implies (`build.ci.frostaura.net` makes `ci.frostaura.net` exist, and a wildcard never
answers for a name that exists) — plus the console host's own label and a fixed list
(`Ops__Cloudflare__ReservedLabels`: www, mail, api, admin, status, ftp, smtp, imap, pop, mx, ns1, ns2).
`complete: false` means the zone was not read (no token, half configured, or Cloudflare did not
answer): the list then holds only the fixed reservations, and the control plane should refuse new
organisation names until it is complete.

## Backups

**What is in an archive.** One sealed tar per run:

| Entry | Content |
| --- | --- |
| `postgres/globals.sql` | `pg_dumpall --globals-only --no-tablespaces`: every role (the app roles Dock makes, with their password hashes, and `endgame_app` / `endgame_system`). |
| `postgres/databases/<name>.dump` | `pg_dump --format=custom --compress=6` of every database except the templates and `postgres`: the platform database and each app's own. Each is a consistent snapshot of its database; the set is not one cross-database instant. |
| `volumes/repositories/…` | The `dock_data` volume, file by file with modes and times: every app's repository (code history) and Dock's small state. |
| `volumes/uploads/…` | The uploaded-files volume, when one is configured. |
| `manifest.json` (last) | Format `endgame-backup/1`, id, time, server version, and per entry its size and SHA-256 (per volume: file count, bytes and a digest over every path and its contents). |

Employee memory, the ledger, the vault's sealed secrets and the data-protection key ring are all
rows in the platform database, so they are in its dump.

**Sealing.** AES-256-GCM over 64 KiB chunks, streamed, so memory stays flat whatever the size:

```
header  "EGBK" | 0x01 | key id (8) | salt (32)
chunk   last (1) | length (4, big-endian) | ciphertext | tag (16)      … repeated
```

Each archive has its own key, HKDF-SHA256(`ENDGAME_BACKUP_KEY`, salt). Chunk *i*'s nonce is *i* and
its last flag; its associated data is the header plus its own flag and length. Reordering, dropping,
truncating, splicing between archives or appending fails authentication, and an archive is complete
only when its final chunk says so — a backup that failed half-way is never finished, so it can never
read as whole. The key id (an HMAC of the key) tells a wrong key apart from a damaged archive.

**Where it goes.** With `ENDGAME_BACKUP_S3_ENDPOINT`, `_BUCKET`, `_ACCESS_KEY_ID` and
`_SECRET_ACCESS_KEY` set, to that S3-compatible bucket — Cloudflare R2 in production
(`https://<account id>.r2.cloudflarestorage.com`, region `auto`) — as `endgame/endgame-<id>.egbk`,
by multipart upload in 16 MiB parts (one part in memory at a time; an upload that fails is aborted
and never visible). The client is Endgame's own SigV4 signer and six S3 operations (no SDK); its
signer reproduces AWS's published example signature (`SigV4Tests`). With no bucket, archives go to
`/backups` (the `backup` volume, or `ENDGAME_BACKUP_DIR`) and `/health` says plainly that nothing
is offsite.

**When.** A timer inside the service (not cron in CI): every `CheckMinutes` (5) it lists the store,
and once the hour `BACKUP_HOUR_UTC` (1) has passed and today has no archive, it runs one. Every
backup and restore holds a PostgreSQL advisory lock (the lease), so a second ops instance or a
`make backup` at the same moment is told another is running instead of running twice. A failure is
logged and retried at the next check. The nightly run skips a server whose every database is still
empty — a fresh stack waiting to be restored onto — so it never files an empty archive as the newest. On demand: `make backup` (or `POST /internal/ops/backups`).

**Retention and the free allowance.** After a successful backup, the newest archive of each of the
last `ENDGAME_BACKUP_KEEP_DAILY` (7) days and of each of the last `ENDGAME_BACKUP_KEEP_WEEKLY` (4) ISO
weeks is kept; the newest is always kept; the rest are deleted. Usage is reported against R2's free
10 GB-month (read as 10⁹ bytes, the stricter reading): the peak is today's total plus one more
archive (tomorrow's is uploaded before anything is pruned), and `warning` is reported once that peak
passes 80 %, `over` once it passes the allowance — on `/health`, `GET /internal/ops/backups`, the
log and the output of `make backup` / `make ops-backups`.

**Restore.** `make restore BACKUP=<id>`: stops Edge, the console, the Runner, Dock and the control
plane; brings up PostgreSQL and ops; then the ops command line **verifies the whole archive first**
(every chunk authenticated, every entry against the manifest) and only then checks the targets —
any listed database that exists with tables, views or sequences, or a non-empty repositories
volume, is a refusal unless `OVERWRITE=1`. Then roles (made tolerant of roles that exist, and never
touching the connecting administrator's own role or password), each database (`pg_restore --create`,
so owner, grants and the `REVOKE CONNECT` Dock sets come back; an existing empty database — the one
the PostgreSQL image creates at start — is dropped first), and the volume files. Finally the whole
stack is started. `OPS_COMPOSE` names the stack (`docker compose -f docker-compose.prod.yml` on the
production host).

**The key.** `ENDGAME_BACKUP_KEY` (32 bytes, hex or base64) comes from the environment. The spec
says "the key held in the vault" — but the vault lives in the platform database, which is inside
the archive, so a key kept only there could never open the backup it would be needed for. The key
must exist outside the machine (the founder's password manager); see *Not built yet*.

## Interfaces

| Endpoint (service token) | Contract |
| --- | --- |
| `GET /health` (no token) | `{ status: healthy | unhealthy, cloudflare: { state: idle | misconfigured | configured, message }, backups: { state: refused | local | offsite | unreachable, message, schedule, nextCheckAt, newest, count, usage, last, running } }`. `503` only when backups are refused (no key, bad key, no database, half-configured bucket). |
| `GET /internal/ops/reserved-hosts` | `{ zone, complete, source: cloudflare | static, readAt, labels: [..], reserved: [{ label, reason, records }], reason }` |
| `GET /internal/ops/cloudflare/plan` | `{ generatedAt, changes: [{ resource: dns | tunnel | worker | route, action: create | update | delete | keep | conflict, target, detail }], hasConflicts, inSync, mutations }`; `409 cloudflare_unconfigured`; `502 cloudflare_error`. |
| `POST /internal/ops/cloudflare/apply?confirm=true` | `{ applied: [change], after: plan }`; `400 confirmation_required` without `confirm=true`; `409 plan_has_conflicts` (with `plan`) — nothing changed. |
| `GET /internal/ops/backups` | `{ destination: offsite | local, describe, backups: [{ id, name, bytes, createdAt }], usage: { usedBytes, allowanceBytes, percent, projectedBytes, state: ok | warning | over | local, message }, last, running }`; `502 backup_store_unreachable`. |
| `POST /internal/ops/backups` | Runs one now and returns `{ id, name, destination, archiveBytes, plaintextBytes, seconds, databases, volumes, pruned }`; `409 backup_running` / `backup_refused`. |

Make targets: `backup`, `restore BACKUP= [OVERWRITE=1]`, `ops-backups`, `ops-verify BACKUP=`,
`ops-health`, `ops-reserved-hosts`, `ops-cloudflare-plan`, `ops-cloudflare-apply CONFIRM=yes`,
`ops-test` (part of `make test`), `ops-test-worker`.

Configuration (environment → `Ops__*`): `ENDGAME_BACKUP_KEY`, `ENDGAME_BACKUP_S3_ENDPOINT`,
`ENDGAME_BACKUP_S3_BUCKET`, `ENDGAME_BACKUP_S3_ACCESS_KEY_ID`, `ENDGAME_BACKUP_S3_SECRET_ACCESS_KEY`,
`ENDGAME_BACKUP_S3_REGION`, `ENDGAME_BACKUP_DIR`, `BACKUP_HOUR_UTC`, `ENDGAME_BACKUP_KEEP_DAILY`,
`ENDGAME_BACKUP_KEEP_WEEKLY`, `ENDGAME_BACKUP_SCHEDULE`, `CLOUDFLARE_API_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_TUNNEL_ID`, `ENDGAME_ZONE`,
`ENDGAME_CONSOLE_HOST`, `CLOUDFLARE_API_BASE_URL` (development: a fake), `ENDGAME_SERVICE_TOKEN`,
and the PostgreSQL administrator from `POSTGRES_USER` / `POSTGRES_PASSWORD`.

## The Cloudflare API token, and the founder's one-time steps

**One custom API token** (My Profile → API Tokens → Create Custom Token), limited to the one
account and the one zone:

| Permission | Level | Why (endpoints) |
| --- | --- | --- |
| Zone · **DNS** · Edit | the `frostaura.net` zone | `GET/POST /zones/{zone}/dns_records`, `PATCH/DELETE …/{id}` |
| Zone · **Workers Routes** · Edit | the `frostaura.net` zone | `GET/POST /zones/{zone}/workers/routes`, `PUT/DELETE …/{id}` |
| Account · **Workers Scripts** · Edit | the account | `PUT /accounts/{account}/workers/scripts/endgame-outage`, `GET …/settings` |
| Account · **Cloudflare Tunnel** · Edit | the account | `GET/PUT /accounts/{account}/cfd_tunnel/{tunnel}/configurations` |

Nothing else: no zone settings, no SSL, no account membership. **A separate R2 credential** for
backups: R2 → Manage API tokens → *Object Read & Write*, applied to **the one bucket** only; it yields
the access key id and secret (S3 credentials, not a bearer token).

The one-time steps, in order:

1. **R2**: create the bucket (e.g. `endgame-backups`) in the account; create the bucket-scoped R2
   token; set the four `ENDGAME_BACKUP_S3_*` keys (endpoint `https://<account id>.r2.cloudflarestorage.com`,
   region `auto`). Cloudflare may ask for a payment method before R2 is enabled, even within the free allowance.
2. **The backup key**: `openssl rand -hex 32` → `ENDGAME_BACKUP_KEY` in the host's `.env`, **and a copy
   in the founder's password manager**. Without it no archive can ever be opened.
3. Run `make backup`, then `make ops-backups`: one archive in the bucket, usage reported.
4. **The tunnel**: confirm the tunnel cloudflared runs (`CLOUDFLARE_TUNNEL_TOKEN`) is remotely managed
   (dashboard-created tunnels are) and note its id → `CLOUDFLARE_TUNNEL_ID`.
5. **Hand-made records**: if the console host already has a record (the dashboard's "public hostname"
   creates one, with no comment), or the zone already has a `*` record, the plan will show a conflict.
   Either delete it, or adopt it by setting its comment to exactly `endgame-managed: console host`
   (or `endgame-managed: organisation subdomains` for `*`).
6. **The token**: create it as above; set `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
   `CLOUDFLARE_ZONE_ID`, `ENDGAME_ZONE` and `ENDGAME_CONSOLE_HOST`; restart the ops service. `/health`
   now says `configured`.
7. `make ops-cloudflare-plan` — read every line: it lists the excluding routes for each of the zone's
   other web hosts and what happens to the tunnel's catch-all. Then `make ops-cloudflare-apply CONFIRM=yes`.
8. In the dashboard (not done through the API here): set the `endgame-outage` routes' **request-limit
   failure mode to fail open**, so exceeding the Free plan's 100,000 Worker requests a day bypasses
   the outage page instead of showing error 1027; and add a **Tunnel Health Alert** notification so
   the founder is told when the machine drops off (spec: "the founder is alerted").
9. Rehearse a restore onto another Docker host before the first outside organisation is invited:
   copy the compose file and `.env` (with the same `ENDGAME_VAULT_MASTER_KEY`, `DOCK_SECRET_KEY` and
   `ENDGAME_BACKUP_KEY`), then `make restore BACKUP=<id> OPS_COMPOSE="docker compose -f docker-compose.prod.yml"`.

## Invariants

| Invariant | Enforced by |
| --- | --- |
| A DNS record without the `endgame-managed` comment is never modified or deleted. | `CloudflareReconciler.PlanRecord`; `ReconcilerTests.No_request_ever_modifies_or_deletes_a_record_endgame_did_not_create`, `…untagged_record…is_a_conflict…` |
| Plan changes nothing; apply needs explicit confirmation, refuses any plan with a conflict, and a second apply is a no-op. | `OpsEndpoints`, `OpsCli`, `Makefile`; `ReconcilerTests.Apply_reaches_the_desired_state_and_a_second_apply_is_a_no_op`, `OpsApiTests` |
| With no token, nothing is called and `/health` says Cloudflare is idle. | `CloudflareReconciler`, `ReservedHosts`, `OpsHealth`; `OpsApiTests`, `ReconcilerTests.With_no_token_nothing_is_called` |
| The outage Worker never runs in front of a non-Endgame host and never replaces a healthy or deliberate answer. | Excluding routes; `worker.js`; `outage-worker.test.mjs` |
| No plaintext leaves the service: every archive is sealed before it reaches a store. | `SealingStream` between the tar writer and the upload; `SealedStreamTests`, the rehearsal's byte search of the uploaded object |
| An archive that is damaged, truncated, unfinished or sealed with another key is refused before anything is restored. | `UnsealingStream`, the manifest check, verify-then-restore; `SealedStreamTests` |
| A restore never overwrites data without `OVERWRITE=1`. | `BackupService.RestoreAsync`; the rehearsal's second restore |
| Two backups or restores never overlap. | PostgreSQL advisory lock `PostgresTools.LeaseKey` |
| Restore is not reachable over HTTP. | Only `OpsCli` calls `RestoreAsync` |

## Decisions

| Decision | Why | Alternatives rejected |
| --- | --- | --- |
| Mark ownership in the DNS **comment**, not tags. | Tags are not on the Free plan; comments are, up to 100 characters. | Tags; a local list of record ids (lost with the machine). |
| Worker-less routes exclude every other web host. | The wildcard route `*.<zone>/*` would otherwise put the outage page in front of every FrostAura site and spend the Worker's daily allowance on them. | A hostname allow-list inside the Worker (still runs, still counts). |
| Replace only `502`, `504`, `52x`, `530` and network failure. | Edge and apps send `500`/`503` deliberately; a paused app's holding page must not become "temporarily unavailable". | Every `5xx`. |
| `pg_dump` per database plus `pg_dumpall --globals-only`, client 16.16 from Alpine. | Custom-format dumps restore with owners and grants; a newer client writes SQL a 16 server can refuse. | One `pg_dumpall` (plain SQL, no per-database integrity); filesystem copy (not consistent while running). |
| Own chunked AES-GCM stream, own SigV4 client. | Flat memory, authenticated truncation, and no SDK dependency; six S3 operations are a page of code, and both are proven against a published vector and a real S3 server. | `age`/`gpg` subprocesses; AWS SDK (R2 needs its checksum defaults turned off). |
| A PostgreSQL advisory lock as the lease. | No schema of its own (only the control plane owns migrations), released automatically if the process dies. | A lease table; a lock file on the volume. |
| Restore on the command line only. | It drops databases; it is an operator's act on the host. | An HTTP endpoint. |

## Measured

The rehearsal (`Endgame.Ops.Tests/Rehearsal/RehearsalTests.cs`, TEST-301) on the development
machine, with a fresh stack holding one organisation, one app repository, a secret, ledger entries
and a separate app database: figures in TEST-301's *Against the running system*.

## Not built yet

- **The key in the vault.** The backup key is read from the environment. Holding it in the vault as
  well (so it rotates with the rest) needs the control plane to hand it to ops, and still needs a
  copy outside the machine; not done.
- **The Cloudflare token in the vault.** The spec says the API credential is held in the vault; it is
  read from the environment here. The control plane would need an internal endpoint to release it to ops.
- **Founder alerting on outage or backup failure** inside Endgame: the log and `/health` carry it;
  nothing notifies. Cloudflare's Tunnel Health Alert (step 8) covers the outage half.
- **The control plane calling ops**: refusing reserved organisation names and showing backup state in
  the console (operator only) are the control plane's to wire.
- **Request-limit fail-open** on the Worker routes is a dashboard step, not set by the API here.
- The production compose file's older `backup` service (plain `pg_dump` to a host directory) still
  runs beside `ops`; it can be removed once an offsite archive and a restore from it are proven.

## Links

- Spec: [`../specs/endgame-spec.md`](../specs/endgame-spec.md) — *Addresses and hosting*
- Use cases: [`UC-301`](../use-cases/UC-301-back-up-and-restore.md), [`UC-302`](../use-cases/UC-302-manage-cloudflare.md)
- Test plan: [`TEST-301`](../testing/TEST-301-ops.md)
- Contracts: [`ARCH-004`](ARCH-004-service-contracts.md) · Cloudflare API reference pages are cited on each `CloudflareClient` method
