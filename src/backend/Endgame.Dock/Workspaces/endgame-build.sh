#!/usr/bin/env bash
# Builds an app into an image archive, with no Dockerfile and no Docker socket (ARCH-005): .NET's
# container publishing writes a ReadyToRun, framework-dependent image on the chiseled base, its
# front end built into wwwroot by the project itself. Never trimmed, never Native AOT.
#
#   endgame-build <source dir> <image repository> <image tag> <archive path>
set -euo pipefail
src="$1" repository="$2" tag="$3" archive="$4"
cd "$src"

case "$(uname -m)" in
  aarch64 | arm64) rid=linux-arm64 ;;
  x86_64 | amd64) rid=linux-x64 ;;
  *) echo "This machine's architecture ($(uname -m)) is not supported." >&2; exit 2 ;;
esac

# The app kit's layout first (api/App.Api.csproj, PLATFORM-API §6); otherwise the one web project.
if [ -f api/App.Api.csproj ]; then
  projects=(./api/App.Api.csproj)
else
  mapfile -t projects < <(grep -rl --include='*.csproj' 'Sdk="Microsoft.NET.Sdk.Web"' . \
    | grep -v -e '/bin/' -e '/obj/' -e '/node_modules/' | sort)
fi
if [ "${#projects[@]}" -ne 1 ]; then
  echo "An app has exactly one web project; this one has ${#projects[@]}." >&2
  exit 3
fi

# The project builds its own front end into wwwroot during publish (the kit's template runs
# `npm ci` and `npm run build` itself), so nothing is built twice here.
echo "Publishing ${projects[0]} for ${rid}"
dotnet publish "${projects[0]}" -c Release -r "$rid" --self-contained false -nologo -v q \
  -p:PublishReadyToRun=true -p:PublishTrimmed=false -p:PublishAot=false \
  -p:ContainerFamily=noble-chiseled -p:ContainerUser=app \
  -p:ContainerRepository="$repository" -p:ContainerImageTag="$tag" \
  -p:ContainerArchiveOutputPath="$archive" \
  /t:PublishContainer
test -s "$archive"
echo "Image archive written: $(du -h "$archive" | cut -f1)"
