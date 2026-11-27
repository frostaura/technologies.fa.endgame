#!/usr/bin/env bash
# The both-address-shapes proof (ARCH-005): build the template into ONE container image, run it with
# its own PostgreSQL and the dev platform (platform API + egress proxy + edge, a test double), and
# drive it in a real browser under a path base AND at a host root.
#
# The app container runs the way Dock will run apps: on an internal network with no route out, a
# read-only root with a no-exec /tmp, every capability dropped, no new privileges, memory and pid
# limits. Its only peers are its database and the platform container.
#
# Every Docker resource is named test-appkit-* and is removed on exit, pass or fail. Nothing else
# is touched. Ports are chosen free at run time on 127.0.0.1.
#
# The same browser test runs against the REAL Edge of a running stack instead: proof/edge.sh.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
KIT="$(cd "$HERE/.." && pwd)"
export MSBuildEnableWorkloadResolver=false DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1

APP_IMAGE=test-appkit-template:proof
PLATFORM_IMAGE=test-appkit-devplatform:proof
NET_APP=test-appkit-net        # internal: the app, its database, the platform
NET_EDGE=test-appkit-edge      # ordinary: the platform's published ports
APP=test-appkit-app            # the platform reaches the app at http://test-appkit-app:8080
DB=test-appkit-proof-pg
PLATFORM=test-appkit-platform
# The app's name in the tree, as Edge sends it: long, as real names are, so the header is seen cutting it short on a phone.
APP_NAME="Dive Club Lost and Found"
DB_PASSWORD="proof-$(python3 -c 'import secrets; print(secrets.token_hex(8))')"

case "$(uname -m)" in
  arm64 | aarch64) ARCH=arm64 ;;
  x86_64 | amd64) ARCH=x64 ;;
  *) echo "proof: unsupported CPU $(uname -m)" >&2; exit 1 ;;
esac

free_port() { python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()'; }
PATH_PORT="$(free_port)"; HOST_PORT="$(free_port)"; PLATFORM_PORT="$(free_port)"

cleanup() {
  local status=$?
  if [ "$status" -ne 0 ]; then
    echo "---- app logs (last 60) ----" >&2; docker logs --tail 60 "$APP" >&2 2>&1 || true
    echo "---- platform logs (last 30) ----" >&2; docker logs --tail 30 "$PLATFORM" >&2 2>&1 || true
  fi
  docker rm -f "$APP" "$PLATFORM" "$DB" > /dev/null 2>&1 || true
  docker network rm "$NET_APP" "$NET_EDGE" > /dev/null 2>&1 || true
  docker image rm "$APP_IMAGE" "$PLATFORM_IMAGE" > /dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT INT TERM

echo "proof: building the template image (front end built in, ReadyToRun, chiseled)…"
dotnet publish "$KIT/template/api/App.Api.csproj" /t:PublishContainer --nologo -v quiet \
  -p:ContainerRepository="${APP_IMAGE%%:*}" -p:ContainerImageTag="${APP_IMAGE##*:}"

echo "proof: building the dev platform image (test double)…"
dotnet publish "$KIT/dev/Endgame.AppKit.DevPlatform.Host/Endgame.AppKit.DevPlatform.Host.csproj" /t:PublishContainer --nologo -v quiet \
  --os linux --arch "$ARCH" -p:ContainerRepository="${PLATFORM_IMAGE%%:*}" -p:ContainerImageTag="${PLATFORM_IMAGE##*:}"

docker network create --internal "$NET_APP" > /dev/null
docker network create "$NET_EDGE" > /dev/null

docker run -d --name "$DB" --network "$NET_APP" --tmpfs /var/lib/postgresql/data \
  -e POSTGRES_USER=app_demo -e POSTGRES_PASSWORD="$DB_PASSWORD" -e POSTGRES_DB=app_demo \
  postgres:16.16-alpine > /dev/null

docker run -d --name "$PLATFORM" --network "$NET_EDGE" \
  -p "127.0.0.1:$PLATFORM_PORT:8080" -p "127.0.0.1:$PATH_PORT:8082" -p "127.0.0.1:$HOST_PORT:8083" \
  -e DEV_APP_URL="http://$APP:8080" -e DEV_APP_NAME="$APP_NAME" -e DEV_PATH_PREFIX=/acme/labs/demo/notes -e DEV_HOST_PREFIX=/labs/demo/notes -e DEV_APP_TOKEN=dev-app-token \
  "$PLATFORM_IMAGE" > /dev/null
docker network connect "$NET_APP" "$PLATFORM"

for i in $(seq 1 30); do docker exec "$DB" pg_isready -U app_demo -d app_demo > /dev/null 2>&1 && break; sleep 1; done

docker run -d --name "$APP" --network "$NET_APP" \
  --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m --cap-drop ALL --security-opt no-new-privileges \
  --memory 256m --pids-limit 256 \
  -e ENDGAME_DATABASE="Host=$DB;Port=5432;Database=app_demo;Username=app_demo;Password=$DB_PASSWORD" \
  -e ENDGAME_PLATFORM_URL="http://$PLATFORM:8080" \
  -e ENDGAME_EGRESS_PROXY="http://$PLATFORM:8081" \
  -e ENDGAME_APP_TOKEN=dev-app-token \
  -e ENDGAME_APP_ID=demo \
  "$APP_IMAGE" > /dev/null

echo "proof: waiting for the app to report healthy through the edge…"
for i in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$HOST_PORT/labs/demo/notes/health" 2> /dev/null | grep -q '"healthy"'; then break; fi
  if [ "$(docker inspect -f '{{.State.Running}}' "$APP")" != "true" ]; then echo "proof: the app exited" >&2; exit 1; fi
  sleep 1
  [ "$i" -eq 60 ] && { echo "proof: the app never became healthy" >&2; exit 1; }
done

echo "proof: path form on :$PATH_PORT, organisation subdomain on :$HOST_PORT, platform on :$PLATFORM_PORT"
cd "$HERE"
npm ci --no-audit --no-fund > /dev/null
CI=1 PW_SCREENSHOTS="${PW_SCREENSHOTS:-}" \
  PW_PATH_URL="http://127.0.0.1:$PATH_PORT/acme/labs/demo/notes/" PW_HOST_URL="http://acme.localhost:$HOST_PORT/labs/demo/notes/" \
  PW_PLATFORM_PORT="$PLATFORM_PORT" npx playwright test
