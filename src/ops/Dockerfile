# syntax=docker/dockerfile:1
# Endgame.Ops: Cloudflare management and backups (ARCH-007). Build context is the repository root.
#
# Its own Dockerfile, not src/backend/Dockerfile, because backups need PostgreSQL's client tools at
# the server's major version (16, as postgres:16.16-alpine): a newer pg_dump writes SQL an older
# server refuses on restore. Alpine packages exactly that client, so the runtime is Alpine and .NET
# is published self-contained for musl onto it. (Not the postgres image itself: it declares a data
# VOLUME, which would give every ops container an anonymous volume.)
ARG DOTNET_SDK=mcr.microsoft.com/dotnet/sdk:10.0.404
ARG RUNTIME_IMAGE=alpine:3.22.2

FROM --platform=$BUILDPLATFORM ${DOTNET_SDK} AS build
ARG TARGETARCH
ENV MSBuildEnableWorkloadResolver=false DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1
WORKDIR /workspace
COPY global.json .editorconfig ./
COPY src/backend/Directory.Build.props src/backend/Directory.Packages.props src/backend/
COPY src/backend/Endgame.Ops/ src/backend/Endgame.Ops/
COPY src/ops/outage-worker/worker.js src/ops/outage-worker/worker.js
ARG BUILD_SHA=
RUN case "$TARGETARCH" in \
      amd64) rid=linux-musl-x64 ;; \
      arm64) rid=linux-musl-arm64 ;; \
      *) echo "unsupported architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac \
    && dotnet publish src/backend/Endgame.Ops/Endgame.Ops.csproj -c Release -r "$rid" --self-contained -o /app/publish \
       ${BUILD_SHA:+-p:SourceRevisionId=$BUILD_SHA}

FROM ${RUNTIME_IMAGE} AS runtime
# .NET's native dependencies on musl; curl for the compose healthcheck; tini as PID 1.
# The `app` user has the uid every Endgame service runs as (1654), so files it restores into the
# repositories volume belong to Dock's user too.
RUN apk add --no-cache postgresql16-client libstdc++ libgcc curl tini \
    && adduser -D -H -u 1654 -s /sbin/nologin app \
    && mkdir -p /backups /data/dock \
    && chown app:app /backups /data/dock \
    && pg_dump --version | grep -q ' 16\.'
COPY --from=build /app/publish /app
ARG BUILD_SHA=unknown
LABEL org.opencontainers.image.revision=$BUILD_SHA \
      org.opencontainers.image.source="https://github.com/frostaura/technologies.fa.endgame"
ENV ASPNETCORE_HTTP_PORTS=8080 DOTNET_EnableDiagnostics=0 BUILD_SHA=$BUILD_SHA
EXPOSE 8080
USER app
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=6 \
    CMD curl --fail --silent http://127.0.0.1:8080/health > /dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--", "/app/Endgame.Ops"]
