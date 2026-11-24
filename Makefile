# The contract: `make up`, `make down`, `make lint`, `make build`, `make test`, `make smoke`.
#
# Every raw dotnet command carries MSBuildEnableWorkloadResolver=false: this Mac's SDK workload
# set is broken and fails restore without it. Harmless everywhere else, so CI uses it too.
.PHONY: up down lint lint-backend lint-frontend build build-backend build-frontend test test-backend test-frontend \
        e2e smoke docker-build docker-down prod-config

DOTNET ?= dotnet
DOTNET_ENV = MSBuildEnableWorkloadResolver=false DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1
SLN = src/backend/Endgame.slnx
EDGE_HOST_PORT ?= 8095
FRONTEND = cd src/frontend &&

# Compose reads .env; a fresh clone (or CI) gets the safe development defaults.
.env:
	cp .env.example .env

up: .env
	docker compose up -d --build --wait

down: .env
	docker compose down

# Also removes the database volume. Local only.
docker-down: .env
	docker compose down -v --remove-orphans

docker-build: .env
	docker compose build

lint: lint-backend lint-frontend

lint-backend:
	$(DOTNET_ENV) $(DOTNET) format $(SLN) --verify-no-changes --verbosity minimal

lint-frontend:
	$(FRONTEND) npm run lint
	$(FRONTEND) npm run typecheck

build: build-backend build-frontend

build-backend:
	$(DOTNET_ENV) $(DOTNET) build $(SLN) --nologo

build-frontend:
	$(FRONTEND) npm run build

test: test-backend test-frontend

test-backend:
	$(DOTNET_ENV) $(DOTNET) test src/backend/Endgame.Tests/Endgame.Tests.csproj --nologo

test-frontend:
	$(FRONTEND) npm run test -- --run

# Playwright against the running stack, through the edge (`make up` first).
e2e:
	$(FRONTEND) CI=1 PW_BASE_URL=http://localhost:$(EDGE_HOST_PORT) npm run test:e2e

# The deployability gate: bring the real stack up, then prove — through the edge — that the
# control plane answers, every service reports healthy, and the console bundle is served.
smoke: up
	@echo "Probing the stack through the edge on :$(EDGE_HOST_PORT)..."
	@for attempt in $$(seq 1 40); do \
		status=$$(curl -fsS http://localhost:$(EDGE_HOST_PORT)/api/system/status 2>/dev/null) \
			&& echo "$$status" | grep -q '"overall":"healthy"' \
			&& curl -fsS http://localhost:$(EDGE_HOST_PORT)/ | grep -q '<div id="root">' \
			&& curl -fsS http://localhost:$(EDGE_HOST_PORT)/health > /dev/null \
			&& { echo "$$status"; echo; echo "smoke: every service healthy through the edge; console served."; exit 0; }; \
		sleep 3; \
	done; \
	echo "smoke: the stack did not report healthy through the edge in time." >&2; \
	curl -sS http://localhost:$(EDGE_HOST_PORT)/api/system/status >&2 || true; \
	docker compose ps >&2; \
	docker compose logs --tail 80 >&2; \
	exit 1

# Parse the production stack file with throwaway values for its required variables.
prod-config:
	POSTGRES_PASSWORD=config-check CLOUDFLARE_TUNNEL_TOKEN=config-check ENDGAME_SERVICE_TOKEN=config-check DOCK_SECRET_KEY=config-check OPENROUTER_API_KEY=config-check docker compose -f docker-compose.prod.yml config -q
