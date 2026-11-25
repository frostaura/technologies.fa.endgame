# ARCH-008 — Deploying on Portainer

How Endgame gets from a push to `main` to a running stack on the Mac mini, and every value that
has to be set on the way. The chain is the house one: GitHub Actions → multi-arch images → Docker
Hub → Portainer → Cloudflare tunnel.

## The shape

```
internet ── Cloudflare tunnel ──▶ gateway (edge) :8095 ──┬─▶ console        (the React front end)
                                                         ├─▶ control plane  (/api, /mcp)
                                                         └─▶ every hosted app, woken on demand
              not published: control plane · runner · dock · egress · ops · postgres
```

- **The gateway is the edge service**, and it is the only thing the stack publishes: one host port
  (`ENDGAME_GATEWAY_PORT`, default 8095). The front end and the back end are both behind it, and so
  is every app Endgame hosts, in both address forms (`endgame.<zone>/<org>/…` and `<org>.<zone>/…`).
- **Dock is the only service given the Docker socket.** It starts each app as a container beside
  the stack, on a network of its own. Those containers are Endgame's, not the stack's: Portainer
  lists them, and they must be left to Dock.
- **Nothing is built on the host.** The stack file names images; a redeploy moves images and nothing
  else.

## What CI publishes

On every push to `main`, after every test job passes, `publish` builds seven images natively for
`amd64` and `arm64`, and `publish-manifest` joins them:

| Image (`<namespace>/technologies.fa.endgame-…`) | What it is |
| --- | --- |
| `edge` | The gateway. |
| `console` | The front end. |
| `control-plane` | The API, identity, vault, credits, model gateway. |
| `runner` | The agent harness and the factory. |
| `dock` | Builds and runs hosted apps. |
| `egress` | The default-deny proxy apps and builds go out through. |
| `ops` | Backups, restore, Cloudflare management. |

Each gets an immutable `sha-<commit>` tag and `latest`. PostgreSQL and (optionally) cloudflared are
pinned upstream images.

## GitHub settings

Repository → Settings → Secrets and variables → Actions.

| Name | Kind | Needed for | Value |
| --- | --- | --- | --- |
| `DOCKERHUB_USERNAME` | secret | publish | The Docker Hub account that pushes. |
| `DOCKERHUB_TOKEN` | secret | publish | An access token for it with read and write. |
| `DOCKERHUB_NAMESPACE` | variable | publish | Only if the images are not pushed under `frostaura`. Must match the stack's `ENDGAME_IMAGE_NAMESPACE`. |
| `PORTAINER_URL` | secret | redeploy | Portainer's address as GitHub's runners reach it, e.g. `https://portainer.frostaura.net`. |
| `PORTAINER_TOKEN` | secret | redeploy | A Portainer access token (My account → Access tokens). |
| `PORTAINER_ENDPOINT_ID` | secret | redeploy | The environment's number: the `1` in `…/#!/1/docker/…`. |
| `PORTAINER_STACK_ID` | secret | redeploy | The stack's number, from its address after it is created: `…/stacks/endgame?id=<n>`. |
| `DEPLOY_ENABLED` | variable | redeploy | `true`, set last. Until then the redeploy job is skipped, not failed. |

Without the two Docker Hub secrets every `publish` job fails at *Log in to Docker Hub*, after its
image has built; nothing earlier depends on them.

## The stack's environment

`.env.production.example` is the whole list, in the order below, ready to paste into Portainer.

**Required — the stack refuses to start without each of these.**

| Variable | What it is | How to make it |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | The platform database's password. | `openssl rand -hex 24` |
| `ENDGAME_SERVICE_TOKEN` | Carried by every call between Endgame's services. | `openssl rand -hex 32` |
| `DOCK_SECRET_KEY` | Derives each app's database name and password. **Never change it.** | `openssl rand -hex 32` |
| `OPENROUTER_API_KEY` | Pays for every model call. Held by the control plane only. | openrouter.ai → Keys |
| `ENDGAME_VAULT_MASTER_KEY` | Seals every stored secret. **Never change it; keep a copy elsewhere.** | `openssl rand -hex 32` |
| `ENDGAME_OPERATORS` | The God-mode e-mail addresses, comma-separated. | Typed in. |
| `ENDGAME_BACKUP_KEY` | Seals every backup. **Keep a copy off the machine.** | `openssl rand -hex 32` |

**Where it lives — defaults work for the Mac mini.**

| Variable | Default | What it is |
| --- | --- | --- |
| `ENDGAME_STACK_NAME` | `endgame` | Must equal the Portainer stack's name: Dock finds `<name>-edge-1`, `-postgres-1` and `-egress-1`. |
| `ENDGAME_GATEWAY_PORT` | `8095` | The host port the gateway is published on. |
| `ENDGAME_CONSOLE_HOST` | `endgame.frostaura.net` | The console's host; also the path form of every app address. |
| `ENDGAME_ZONE` | `frostaura.net` | Organisation subdomains are `<org>.<zone>`. |
| `ENDGAME_IMAGE_TAG` | `latest` | A `sha-<commit>` tag pins a release; this is also how to roll back. |
| `ENDGAME_IMAGE_NAMESPACE` | `frostaura` | Where the images are pulled from. |
| `DOCKER_SOCKET_GID` | `0` | The socket's group as Dock sees it: `0` on Docker Desktop; on Linux, `stat -c %g /var/run/docker.sock`. |

**The tunnel — one of two ways.**

| Way | Set | Route in Cloudflare |
| --- | --- | --- |
| A tunnel already on the host (as the other stacks use) | nothing | `endgame.<zone>` and `*.<zone>` → `http://localhost:<ENDGAME_GATEWAY_PORT>` |
| The tunnel inside this stack | `COMPOSE_PROFILES=tunnel`, `CLOUDFLARE_TUNNEL_TOKEN` | the same two hosts → `http://edge:8080` |

A wildcard route catches every other host in the zone, so the zone's existing sites need their own
routes listed above it. `ARCH-007` covers this, and the proxied `*` DNS record the subdomains need.

**Optional.**

| Variables | Left empty |
| --- | --- |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_STARTTLS` | No mail is sent; invitations and shares are handed over as links. |
| `ENDGAME_BACKUP_S3_ENDPOINT`, `_BUCKET`, `_ACCESS_KEY_ID`, `_SECRET_ACCESS_KEY`, `_REGION` | Backups stay on the machine; the ops service reports them as not offsite. |
| `ENDGAME_BACKUP_DIR`, `BACKUP_HOUR_UTC`, `ENDGAME_BACKUP_KEEP_DAILY`, `ENDGAME_BACKUP_KEEP_WEEKLY`, `ENDGAME_BACKUP_SCHEDULE` | Nightly at 01:00 UTC into a volume; seven daily and four weekly kept. |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_TUNNEL_ID` | Endgame changes nothing in Cloudflare; DNS and routes are set by hand. With a token, changes still need an explicit apply (`ARCH-007`). |
| `DOCK_APP_MEMORY_BUDGET_MB`, `DOCK_SUBNET_POOL`, `ENDGAME_USAGE_REPORT_SECONDS`, `POSTGRES_USER`, `POSTGRES_DB` | 4096 MB for awake apps; app networks cut from `10.213.0.0/16`. |

## First deploy

1. Add the two Docker Hub secrets and push to `main`; wait for `publish-manifest` to go green.
2. In Portainer: Stacks → Add stack, **named `endgame`**, web editor, paste `docker-compose.prod.yml`.
3. Environment variables → Advanced mode → paste `.env.production.example`, filled in. Save the
   three keys marked *never change* and the backup key somewhere other than this machine.
4. Deploy. Every service reports healthy within about a minute; `http://<host>:8095/health` answers.
5. Route the tunnel (above). Open `https://endgame.<zone>/`, register a passkey with an address in
   `ENDGAME_OPERATORS`, and top the organisation up.
6. For automatic redeploys, add the four `PORTAINER_*` secrets and set `DEPLOY_ENABLED=true`.

## Redeploy, and going back

- **Automatic:** with `DEPLOY_ENABLED=true`, each green push asks Portainer to pull and redeploy,
  sending the stack file and environment back exactly as Portainer holds them.
- **By hand:** in the stack, *Pull and redeploy*.
- **A changed stack file** is not delivered by a redeploy: when `docker-compose.prod.yml` changes
  in the repository, paste it into the stack again.
- **Going back:** set `ENDGAME_IMAGE_TAG=sha-<the earlier commit>` and update the stack. Database
  migrations only go forward, so going back across one needs a restore (`ARCH-007`).

## Not verified

Nothing has been pushed to Docker Hub or deployed through Portainer yet: the publish and redeploy
jobs have not run with credentials. The stack file has been run on a development machine against
locally built images under the published names. Hosted apps and the public tunnel have not been
exercised over HTTPS.
