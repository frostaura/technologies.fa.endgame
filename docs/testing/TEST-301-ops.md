# TEST-301 — Ops: Cloudflare management, the outage page, backups and the rehearsed restore

| Field | Value |
| --- | --- |
| **ID** | TEST-301 |
| **Covers** | UC-301 · UC-302 · ARCH-007 |
| **Status** | Current |

`make ops-test` runs all of it (and `make test` runs `ops-test`): the .NET tests in
`src/backend/Endgame.Ops.Tests` and the Worker's tests under Node (`make ops-test-worker`). The
rehearsal is the one test that needs Docker (`Category=Docker`); `ENDGAME_SKIP_DOCKER_TESTS=1` skips
it on a machine without Docker. **No test calls Cloudflare**: the Cloudflare side runs against
`FakeCloudflare`, an in-test HTTP server reproducing the request and response shapes of the
reference pages cited on each `CloudflareClient` method.

## What must be true

| Statement | Test |
| --- | --- |
| A fresh account: plan creates everything and changes nothing. | `ReconcilerTests.On_a_fresh_account_the_plan_creates_everything_and_changes_nothing` |
| Apply reaches the desired state; a second apply is a no-op with zero mutating requests. | `ReconcilerTests.Apply_reaches_the_desired_state_and_a_second_apply_is_a_no_op` |
| An untagged record where Endgame needs one is a conflict, apply refuses, the record is untouched; marking it adopts it. | `ReconcilerTests.An_untagged_record_where_endgame_needs_one_is_a_conflict_and_is_never_touched` |
| No request ever patches or deletes a record without the mark; a stale managed one is deleted. | `ReconcilerTests.No_request_ever_modifies_or_deletes_a_record_endgame_did_not_create` |
| A drifted managed record is put back. | `ReconcilerTests.A_managed_record_that_drifted_is_put_back` |
| Other hostnames' ingress rules survive in order; config keys survive; catch-all 404 last. | `ReconcilerTests.Other_hostnames_on_the_tunnel_keep_their_rules_in_order` |
| The Worker is uploaded only when its source mark differs. | `ReconcilerTests.A_changed_worker_is_uploaded_again_and_an_unchanged_one_never` |
| Another Worker on an Endgame pattern is a conflict. | `ReconcilerTests.Another_workers_route_on_an_endgame_pattern_is_a_conflict` |
| No token: no call; a console host two levels down: refused before any call; a wrong token: Cloudflare's error. | `ReconcilerTests.With_no_token_nothing_is_called`, `…two_levels_down…`, `…wrong_token…` |
| DNS listing reads every page. | `ReconcilerTests.Records_are_read_across_every_page` |
| Reserved hosts: every label the zone uses, including one a deeper record implies; cached; incomplete without a token. | `ReconcilerTests.Reserved_hosts_*` |
| `/health` says idle with no token and local with no bucket; `503` without a backup key. | `OpsApiTests.With_no_token_*`, `OpsApiTests.Without_a_backup_key_*` |
| Internal endpoints need the service token; apply needs `confirm=true`; a conflicting plan is refused with the plan attached. | `OpsApiTests` |
| Sealing round-trips any length; the plaintext never appears; a wrong key, any altered byte, a truncation (even at a chunk boundary), an unfinished archive, appended bytes and swapped chunks all fail. | `SealedStreamTests` |
| SigV4 reproduces AWS's published "GET Object" signature. | `SigV4Tests` |
| Retention, usage warnings, the nightly due rule, role restoration and configuration refusals. | `BackupPolicyTests` |
| The outage Worker: healthy and deliberate answers (200, 3xx, 403, 404, 500, 501, 503) pass through unchanged; 502, 504, 520–527, 530 and network failures become the page (HTML for navigations, plain text otherwise, no body for HEAD); the page is self-contained and names no infrastructure. | `src/ops/outage-worker/outage-worker.test.mjs` |
| **Backup → destroy → restore**: every piece of data comes back and the secret still decrypts; the archive is sealed; a second restore over live data is refused. | `Rehearsal/RehearsalTests.Backup_then_destroy_then_restore_brings_every_piece_of_data_back` |

## The rehearsal

A stack of its own: compose project `test-endgame-ops-rehearsal`, free loopback ports, subnet pool
`10.219.0.0/16`, throwaway secrets, `--env-file` an empty file so the developer's `.env` is never
read; plus a test-only S3-compatible server (`versity/versitygw:v1.0.16`, container
`test-endgame-ops-s3` on network `test-endgame-ops-s3net`) outside the stack. MinIO was the first
choice; its images are no longer pullable from Docker Hub or quay.io on this machine.

1. Build and start the whole stack with the e2e overlay (Dock's API on loopback) and the rehearsal overlay.
2. Through the real Edge: the development sign-in, an organisation, a division, a project and an app;
   through Dock: the app's repository (an initial commit); a secret at the organisation; two operator
   top-ups (ledger entries). Through `psql`: an app database owned by its own login role, closed to `PUBLIC`, with a row.
3. Snapshot: the repository head, the secret **as the app reads it** (a fresh app token, then
   `GET /platform/v1/secrets/REHEARSAL_SECRET` on the control plane), the balance, the top-ups, the
   ledger row count, the inherited secret names, the tree.
4. `make backup` (with `OPS_COMPOSE` naming this stack). The bucket holds exactly one object; it starts
   `EGBK` and contains neither the secret nor the app database's row.
5. `docker compose down -v`: every volume of the stack is gone.
6. `make restore BACKUP=<id>`.
7. The snapshot again — equal in every field — and the app database's row read **as its own role with
   its own password**.
8. A second restore without `OVERWRITE=1` is refused, and the ledger is unchanged.
9. Teardown: the stack with its volumes and images, anything Dock labelled with the project, the S3
   server and its network.

## Fixture variation

| Test | The one field that, changed, makes it fail |
| --- | --- |
| No untagged record is modified | Comment the console record `endgame-managed…` and it is adopted and corrected (`…adopts it` step); remove the mark from the stale record and it is no longer deleted. |
| Second apply is a no-op | Change the fake's stored Worker hash binding and the next apply uploads again (`A_changed_worker…`). |
| Outage page on 530 | Status 503 instead: passed through (the deliberate-status cases). |
| Wrong key | The same key: round-trips. |
| Rehearsal | The backup key had 33 bytes on the first run: the ops service reported `unhealthy` and the stack never came up; `The_development_stacks_default_backup_key_is_a_valid_key` now guards the compose default. |

## Against the running system

The rehearsal *is* the running-system check: the real images, the real Makefile targets, a real S3
server, the real Edge, Dock and control plane. Measured on the development machine (Docker Desktop,
the other lanes' stacks running), 2026-11-25:

| Step | Run 1 | Run 2 | Run 3 (final code) |
| --- | --- | --- | --- |
| Stack up (images cached after the first build) | 32 s | (in `make test`) | 22 s |
| `make backup`, wall | 1.4 s | — | 1.5 s |
| Backup itself (dump, seal, upload) | 0.2 s | — | 0.2 s |
| Archive in the bucket (sealed / before sealing) | 542,954 / 542,720 bytes | — | 714,516 / 714,240 bytes |
| `make restore`, wall (stop, empty PostgreSQL + ops up, verify, restore, whole stack up) | 25.5 s | — | 25.8 s |
| Verify (every chunk and entry) / restore itself | 0.05 s / 0.33 s | — | 0.06 s / 0.36 s |
| Whole test | 1 min 11 s | 1 min 15 s (all 51 ops tests) | 1 min 3 s |

The archive holds the platform database, the app database, the roles and one app repository; the
sealing overhead is 45 bytes plus 21 per 64 KiB. Almost all of `make restore`'s time is the stack
starting, not the restore. These are figures for a nearly empty platform: dump and upload time grow
with the data, and against R2 the upload runs at the machine's uplink.

Not exercised: Cloudflare R2 itself (only an S3-compatible server), the live Cloudflare API, the
Worker on Cloudflare's runtime (it is run under Node with a stubbed fetch), a restore onto a second
physical host.

## States covered

`/health`: idle, misconfigured, configured; local, offsite, refused, unreachable. Backups list: empty
(genuinely), a failed read is `502 backup_store_unreachable`, never an empty list. Reserved hosts:
complete, incomplete (with a reason).
