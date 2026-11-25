# syntax=docker/dockerfile:1
# The egress proxy: the only way out for apps, workspaces and builds (CLAUDE.md, "Never do here":
# no unrestricted egress). Default deny. Dock writes the per-network allow-lists into
# /etc/squid/policy/endgame.conf through the Engine API and reloads the proxy; nothing else does.
FROM alpine:3.22.2
RUN apk add --no-cache squid \
    && mkdir -p /etc/squid/policy /run/squid /var/cache/squid /var/log/squid \
    && : > /etc/squid/policy/endgame.conf \
    && chown -R squid:squid /etc/squid/policy /run/squid /var/cache/squid /var/log/squid
COPY squid.conf /etc/squid/squid.conf
# Not root: squid runs as its own unprivileged user from the first process.
USER squid
EXPOSE 3128
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=6 CMD nc -z 127.0.0.1 3128 || exit 1
# A pid file left by a container that was killed (Docker itself stopping uncleanly) names PID 1, which the restarted
# squid also is, so squid would refuse to start ("already running") on every restart. Nothing else runs in this
# container, so a pid file present at start is always stale.
ENTRYPOINT ["/bin/sh", "-c", "rm -f /run/squid/squid.pid && exec squid -N -d 1 -f /etc/squid/squid.conf"]
