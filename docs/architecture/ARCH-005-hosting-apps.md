# ARCH-005 — Hosting apps: build, run, route, sleep, wake

Design rules for Dock, Edge and the app kit, from a spike run on 2026-11-24 on the host machine
(Docker Desktop, a Linux virtual machine with about 8 GB and 10 CPUs, other stacks running). The
spike's code was thrown away; these rules are what it bought.

## The answer

.NET can build, run, route to, sleep and wake a one-container app on this machine. **A visitor
waking a sleeping app waits about 0.3 seconds for the first byte (0.42 worst of 15)**, and the
proxy adds about 0.2 ms to a request once the app is awake. Forty awake apps ran together with no
slowdown; each holds 40 to 55 MB idle. A stopped app holds no memory.

## Building an image

- **ReadyToRun on the chiseled base image**, framework-dependent: 214 MB on disk, about 6 seconds
  for a warm build, the fastest wake. **Never trimmed, never Native AOT** — both fail with EF Core.
- No Dockerfile per app: the front end is built into `wwwroot`, then .NET's container publishing
  makes the image.
- **Builds run in a throwaway SDK container with no socket** and write an image archive that Dock
  loads through the Engine API. Raise Dock's request-size limit for that upload.
- Run as the non-root `app` user; set `DOTNET_EnableDiagnostics=0` for the read-only root.

## Running an app

| Rule | Why |
| --- | --- |
| Each app gets its own internal network, with a subnet **Dock assigns itself** (a /28 from a private /16). | Docker's default address pools ran out after about 25 networks. |
| Dock never joins an app network. Edge joins each one and polls health. | Keeps the socket holder out of reach of apps. |
| Memory, CPU and process limits; read-only root with a no-exec temporary directory; no new privileges; all capabilities dropped; no socket. | All verified to hold on this machine. |
| **Disk quotas, AppArmor and gVisor do not work here.** | Accepted silently or absent. Disk use must be watched, not capped. |
| Budget memory by real use, not by the limit. | Forty 256 MB limits exceed the machine. |
| Sleep is stop-and-keep, never remove. | The wake figure depends on it. |
| The evaluator's preview is a second container, `app-<id:N>-pv`, on the app's network with a throwaway database (`p_…`, the app's role), labelled `app-preview` so nothing samples, reports or charges it as the app; destroyed with its database after evaluation. | Evaluation data must never reach the published app. The suffix is short: a host-name label is at most 63 characters. |
| The egress proxy drops a stale pid file at start, and Dock waits for it to accept connections after each reconfigure. | A container killed with Docker left squid unable to restart ("already running"); a reconfigure briefly closes the port. |

## Waking

- **One wake at a time per app:** concurrent requests share it; start and stop share a lock; Edge
  counts in-flight requests so the idle sweep never stops an app that is serving.
- **Stagger simultaneous wakes.** Twenty at once took 1.3 seconds median, forty 2.8 — and after a
  restart of the host every app is asleep at once.
- **Every wake rejoins the app's peers to its network** (edge, database, egress proxy; idempotent): a redeployed edge is
  a new container on no app network, and on the acceptance stack every app answered 503 until this was done.
- **Fail fast on a crash.** Dock watches for the container exiting; Edge serves a proper
  unavailable page instead of waiting out a timeout.

## Addresses — what every generated app must do

One image serves both the path form and the organisation subdomain:

1. Front-end assets are built with relative URLs.
2. The page carries a base element that **the server rewrites on every request** from the
   forwarded prefix. Never serve the page through default-file handling.
3. Every request the front end makes is resolved against the page's base; no leading-slash URLs.
4. The router's base comes from the page's base.
5. The server honours forwarded prefix, host and protocol headers.
6. Edge redirects a project path with no trailing slash to one with it, strips the prefix, and sets
   the forwarded prefix itself.

**Path-form apps share one browser origin** — cookies, local storage and service workers are not
separated between apps. The kit must not trust origin-scoped storage, and an app that needs
isolation is served in subdomain form. This is the accepted cost recorded in the spec.

## Reaching the outside

An app on its internal network reaches only the shared database and the egress proxy. Three gaps
the spike found, each now a rule:

- **Edge's control interface must sit on a listener apps cannot reach.**
- **An app's database role must not be able to connect to the platform's database or list other
  databases by name.** Revoke connection from the public role; give app databases and roles opaque
  names; cap each app's connections.
- **The egress allow-list is per app**, keyed by the app's subnet.

## Not verified

Waking after the host or Docker restarts with a cold disk cache; a first build on a machine with
empty package caches; an app's own HTTP client going out through the proxy; more than 40 apps;
apps under real load; anything over HTTPS or through the tunnel.
