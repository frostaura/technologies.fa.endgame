# UC-301 — Back up everything, and restore it onto an empty stack

| Field | Value |
| --- | --- |
| **ID** | UC-301 |
| **Title** | Keep a nightly encrypted copy of everything offsite, and restore it onto any Docker host |
| **Primary actor** | System (the nightly backup) · the founder, as the host's operator (on-demand backup, restore) |
| **Scope** | Ops (`Endgame.Ops`), PostgreSQL, the repositories volume, an S3-compatible bucket (Cloudflare R2) |
| **Cascade level** | None: a backup covers the whole platform — every organisation, every app |
| **Status** | Built (tested against a local S3-compatible server; not yet run against R2) |

## Goal

If the Mac mini is lost, at most a day is lost: last night's archive restores every organisation,
app, repository, secret, ledger entry and employee memory onto another Docker host, and no one who
obtains the archive without the key can read any of it.

## Preconditions

- `ENDGAME_BACKUP_KEY` is set (32 bytes), and a copy is held outside the machine.
- For an offsite copy, the four `ENDGAME_BACKUP_S3_*` keys name a bucket the credential may write.
- For a restore: the same `.env` as the lost stack (its `ENDGAME_VAULT_MASTER_KEY`, `DOCK_SECRET_KEY`
  and `ENDGAME_BACKUP_KEY` above all), the images, and an empty stack.

## Main flow — nightly

1. Every five minutes the ops service lists the store. Once `BACKUP_HOUR_UTC` has passed and today
   has no archive, it takes the lease (a PostgreSQL advisory lock).
2. It dumps the roles, then every database, then archives the repositories volume, writing a manifest
   last; the whole stream is sealed (AES-256-GCM, 64 KiB chunks) and uploaded part by part.
3. On success it prunes to the newest of each of the last 7 days and 4 weeks, and reports usage
   against the 10 GB free allowance.

## Main flow — restore

1. The operator runs `make restore BACKUP=<id>` (`make ops-backups` lists ids).
2. The services that write data stop; PostgreSQL and ops start (on fresh volumes: empty).
3. Ops reads the whole archive and checks every chunk and every entry against the manifest.
4. It checks that each database it would restore is empty or absent, and the repositories volume empty.
5. It restores roles, each database with its owner and grants, and every repository file.
6. The whole stack starts again.

## Alternate and failure flows

- **A1 — No bucket configured.** Archives go to the `backup` volume (or `ENDGAME_BACKUP_DIR`), and
  `/health` and `make backup` say plainly that nothing is offsite.
- **A2 — No key.** No backup runs; `/health` is `503` and names `ENDGAME_BACKUP_KEY`.
- **A3 — A backup fails half-way.** The upload is aborted (never visible); the archive is never
  sealed as finished; the failure is logged and on `/health`; the next check retries.
- **A4 — Another backup or restore holds the lease.** This one is told so and does not run.
- **A5 — The archive is damaged, truncated, unfinished or sealed with another key.** Restore stops at
  verification, naming which, before anything is touched.
- **A6 — The target already holds data.** Restore refuses, listing what is there, unless `OVERWRITE=1`.
- **A7 — The next archive would pass the free allowance.** Usage turns `warning` past 80 % of it,
  `over` past it; both say what to do (keep fewer archives, or accept the charge).

## Postconditions

- Nightly: one more sealed archive in the store, older ones pruned, usage reported. No credits are
  charged: backup is the platform's own cost.
- Restore: the stack holds exactly what the archive held; sealed secrets open with the same vault key.

## Rules this use case must honour

- Never commit or print a secret: archives are sealed before they leave the service; credentials come
  from the environment and are passed to the PostgreSQL tools in their environment, never on a command line.
- Only Dock touches Docker: ops has no socket; the Makefile, run by the operator, starts and stops services.
- Tenant data is never used across organisations: the archive is opaque and only restores the platform as it was.

## Acceptance

- An archive of a stack with an organisation, an app repository with a commit, a secret, ledger entries
  and an app database restores onto a destroyed stack with every one of them back, and the secret still
  decrypts through the platform API (TEST-301, the rehearsal).
- The uploaded archive starts `EGBK` and contains neither the secret nor any row in plaintext.
- A second restore over the restored stack without `OVERWRITE=1` is refused and changes nothing.
- Any altered byte, a truncation, an unfinished archive or a wrong key fails before restore.
- Retention keeps the newest per day for 7 days and per ISO week for 4 weeks, and never the last one less.

## Links

- Spec: *Addresses and hosting* · [`ARCH-007`](../architecture/ARCH-007-cloudflare-and-backups.md) · [`TEST-301`](../testing/TEST-301-ops.md)
