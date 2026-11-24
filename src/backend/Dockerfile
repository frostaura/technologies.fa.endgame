# syntax=docker/dockerfile:1
# One Dockerfile for every .NET service. PROJECT picks which: Endgame.ControlPlane, Endgame.Edge,
# Endgame.Runner or Endgame.Dock. Build context is the repository root.
ARG DOTNET_SDK=mcr.microsoft.com/dotnet/sdk:10.0.404
ARG DOTNET_RUNTIME=mcr.microsoft.com/dotnet/aspnet:10.0.15

FROM ${DOTNET_SDK} AS build
ARG PROJECT
RUN test -n "$PROJECT" || (echo "build-arg PROJECT is required" >&2; exit 1)
ENV MSBuildEnableWorkloadResolver=false
WORKDIR /workspace
COPY global.json ./
COPY .editorconfig ./
COPY src/backend/ src/backend/
RUN dotnet restore src/backend/${PROJECT}/${PROJECT}.csproj
# The commit this image is built from, stamped into the assembly's informational version.
# CI passes github.sha; a local build without it reports "unknown" rather than a guess.
ARG BUILD_SHA=
RUN dotnet publish src/backend/${PROJECT}/${PROJECT}.csproj -c Release -o /app/publish --no-restore \
    -p:UseAppHost=false ${BUILD_SHA:+-p:SourceRevisionId=$BUILD_SHA}

# The app-kit template every new app's repository starts from, for Dock. The glob tolerates the
# template being absent (Dock then reports it missing and refuses to create repositories); the
# Dockerfile itself is copied only so the instruction always has one source, and is removed below.
FROM scratch AS app-template
COPY src/backend/Dockerfile src/appkit/templat[e] /template/

FROM ${DOTNET_RUNTIME} AS runtime
ARG PROJECT
WORKDIR /app
# curl for the compose healthcheck; tini as PID 1 so a start-up crash exits and the restart policy
# fires, instead of dotnet-as-init spinning on its own SIGABRT. Dock also drives the git CLI.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl tini $([ "$PROJECT" = "Endgame.Dock" ] && echo git) \
    && rm -rf /var/lib/apt/lists/*
COPY --from=app-template /template/ /opt/endgame/app-template/
# Only Dock keeps the template; only Dock has a data directory (repositories, its small state).
RUN rm -f /opt/endgame/app-template/Dockerfile \
    && if [ "$PROJECT" = "Endgame.Dock" ]; then mkdir -p /data && chown app:app /data; else rm -rf /opt/endgame; fi
COPY --from=build /app/publish .
ENV APP_DLL=${PROJECT}.dll
ENV ASPNETCORE_HTTP_PORTS=8080
EXPOSE 8080
ARG BUILD_SHA=unknown
LABEL org.opencontainers.image.revision=$BUILD_SHA \
      org.opencontainers.image.source="https://github.com/frostaura/technologies.fa.endgame"
ENV BUILD_SHA=$BUILD_SHA
# Not root. The aspnet image ships `app` as uid 1654; fail the build if that ever moves.
RUN test "$(id -u app)" = 1654
USER app
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=6 \
    CMD curl --fail --silent http://127.0.0.1:8080/health > /dev/null || exit 1
ENTRYPOINT ["/usr/bin/tini", "--", "/bin/sh", "-c", "exec dotnet /app/$APP_DLL"]
