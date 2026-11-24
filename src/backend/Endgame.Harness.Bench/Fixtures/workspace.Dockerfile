# Workspace image for the harness benchmark (ported from the 2026-11-24 spike): .NET 10 SDK + Node 22, dotnet-ef, the fixture pre-restored at /seed.
# Task runs start a fresh container from this image with no network, copy /seed to /workspace and work there.
FROM node:22-bookworm-slim AS node

FROM mcr.microsoft.com/dotnet/sdk:10.0
ENV DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1 DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1 \
    NUGET_XMLDOC_MODE=skip CI=1 NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false NO_COLOR=1 FORCE_COLOR=0 DOTNET_CONSOLE_ANSI_COLOR=false
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
 && apt-get update && apt-get install -y --no-install-recommends ripgrep && rm -rf /var/lib/apt/lists/* \
 && useradd -m -u 1000 -s /bin/bash agent || useradd -m -s /bin/bash agent
RUN dotnet tool install --tool-path /usr/local/dotnet-tools dotnet-ef --version 10.0.12
ENV PATH="/usr/local/dotnet-tools:${PATH}"
RUN mkdir /workspace && chown agent:agent /workspace
COPY --chown=agent:agent . /seed
USER agent
WORKDIR /seed
RUN dotnet restore Library.slnx && dotnet build Library.slnx --no-restore -v q \
 && cd web && npm ci && npm run build && rm -rf dist \
 && cd /seed && git init -q && git config --global user.email agent@workspace.local && git config --global user.name agent \
 && git config --global init.defaultBranch main && git config --global --add safe.directory '*'
CMD ["sleep", "infinity"]
