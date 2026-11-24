# The workspace image: every workspace and every app build runs in a container of it. Built by
# Dock itself, through the Engine API, from this file, endgame-build.sh and the app-kit template;
# tagged by a hash of all three so a changed template yields a fresh image.
#
# .NET SDK and Node, with the template's packages already restored and a warm ReadyToRun publish
# done, so the first build of a new app finds its NuGet and npm caches full.
FROM node:22.21.1-bookworm-slim AS node

FROM mcr.microsoft.com/dotnet/sdk:10.0.404
ENV DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1 DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1 \
    DOTNET_GENERATE_ASPNET_CERTIFICATE=false NUGET_XMLDOC_MODE=skip MSBuildEnableWorkloadResolver=false \
    CI=1 NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false \
    NO_COLOR=1 FORCE_COLOR=0 DOTNET_CONSOLE_ANSI_COLOR=false
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
 && apt-get update && apt-get install -y --no-install-recommends ripgrep && rm -rf /var/lib/apt/lists/* \
 && test "$(id -u app)" = 1654 \
 && mkdir -p /workspace /src /out && chown 1654:1654 /workspace /src /out
COPY endgame-build.sh /usr/local/bin/endgame-build
RUN chmod 0755 /usr/local/bin/endgame-build
COPY --chown=1654:1654 template/ /opt/endgame/template/
USER 1654
ENV HOME=/home/app
RUN if [ -n "$(ls -A /opt/endgame/template)" ]; then \
      cp -r /opt/endgame/template /tmp/warm \
      && endgame-build /tmp/warm endgame-warmup latest /tmp/warm.tar.gz \
      && rm -rf /tmp/warm /tmp/warm.tar.gz; \
    fi
WORKDIR /workspace
CMD ["sleep", "infinity"]
