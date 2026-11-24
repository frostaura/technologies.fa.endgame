#!/usr/bin/env bash
# Builds an app into an image archive, with no Dockerfile and no Docker socket (ARCH-005):
# every front end is built into its project's wwwroot, then .NET's container publishing writes a
# ReadyToRun, framework-dependent image on the chiseled base. Never trimmed, never Native AOT.
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

mapfile -t projects < <(grep -rl --include='*.csproj' 'Sdk="Microsoft.NET.Sdk.Web"' . \
  | grep -v -e '/bin/' -e '/obj/' -e '/node_modules/' | sort)
if [ "${#projects[@]}" -ne 1 ]; then
  echo "An app has exactly one web project; this one has ${#projects[@]}." >&2
  exit 3
fi

while IFS= read -r manifest; do
  dir="$(dirname "$manifest")"
  if grep -q '"build"[[:space:]]*:' "$manifest"; then
    echo "Building the front end in ${dir}"
    (
      cd "$dir"
      if [ -f package-lock.json ]; then npm ci --prefer-offline; else npm install --prefer-offline; fi
      npm run build
    )
  fi
done < <(find . -name package.json -not -path '*/node_modules/*' | sort)

echo "Publishing ${projects[0]} for ${rid}"
dotnet publish "${projects[0]}" -c Release -r "$rid" --self-contained false -nologo -v q \
  -p:PublishReadyToRun=true -p:PublishTrimmed=false -p:PublishAot=false \
  -p:ContainerFamily=noble-chiseled -p:ContainerUser=app \
  -p:ContainerRepository="$repository" -p:ContainerImageTag="$tag" \
  -p:ContainerArchiveOutputPath="$archive" \
  /t:PublishContainer
test -s "$archive"
echo "Image archive written: $(du -h "$archive" | cut -f1)"
