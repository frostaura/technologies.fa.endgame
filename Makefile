# The contract: `make up`, `make down`, `make lint`, `make build`, `make test`, `make smoke`, and
# `make e2e-stack` (the merged stack's acceptance test). lint, build and test cover the backend,
# the console and the app kit.
#
# Every raw dotnet command carries MSBuildEnableWorkloadResolver=false: this Mac's SDK workload
# set is broken and fails restore without it. Harmless everywhere else, so CI uses it too.
.PHONY: up down lint lint-backend lint-frontend build build-backend build-frontend test test-backend test-frontend \
        e2e smoke docker-build docker-down prod-config appkit-build appkit-lint appkit-test appkit-proof appkit-vendor \
        stack-up stack-down e2e-stack e2e-stack-run fac-up fac-down e2e-factory e2e-factory-run

DOTNET ?= dotnet
DOTNET_ENV = MSBuildEnableWorkloadResolver=false DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1
SLN = src/backend/Endgame.slnx
EDGE_HOST_PORT ?= 8095
FRONTEND = cd src/frontend &&

# Compose reads .env; a fresh clone (or CI) gets the key names, and docker-compose.yml's
# development defaults fill every one left empty.
.env:
	cp .env.example .env

# Dock's image carries the app kit's template, so the kit is packed into it first.
up: .env appkit-vendor
	docker compose up -d --build --wait

down: .env
	docker compose down

# Also removes the database volume. Local only.
docker-down: .env
	docker compose down -v --remove-orphans

docker-build: .env appkit-vendor
	docker compose build

lint: lint-backend lint-frontend appkit-lint

lint-backend:
	$(DOTNET_ENV) $(DOTNET) format $(SLN) --verify-no-changes --verbosity minimal

lint-frontend:
	$(FRONTEND) npm run lint
	$(FRONTEND) npm run typecheck

build: build-backend build-frontend appkit-build

build-backend:
	$(DOTNET_ENV) $(DOTNET) build $(SLN) --nologo

build-frontend:
	$(FRONTEND) npm run build

test: test-backend test-frontend appkit-test

test-backend:
	$(DOTNET_ENV) $(DOTNET) test src/backend/Endgame.Tests/Endgame.Tests.csproj --nologo

test-frontend:
	$(FRONTEND) npm run test -- --run

# The app kit (src/appkit/Makefile): its SDKs and template, their tests against a throwaway
# PostgreSQL, and the both-addresses browser proof against the kit's dev platform.
appkit-build:
	$(MAKE) -C src/appkit build

appkit-lint:
	$(MAKE) -C src/appkit lint

appkit-test:
	$(MAKE) -C src/appkit test

appkit-proof:
	$(MAKE) -C src/appkit proof

appkit-vendor:
	$(MAKE) -C src/appkit vendor

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

# Parse the production stack file with throwaway values for its required variables, and prove it
# can never turn the development sign-in on, whatever the environment says.
PROD_CHECK_ENV = POSTGRES_PASSWORD=config-check CLOUDFLARE_TUNNEL_TOKEN=config-check ENDGAME_SERVICE_TOKEN=config-check \
	DOCK_SECRET_KEY=config-check OPENROUTER_API_KEY=config-check ENDGAME_VAULT_MASTER_KEY=config-check ENDGAME_OPERATORS=config-check

prod-config:
	@env $(PROD_CHECK_ENV) docker compose -f docker-compose.prod.yml config -q
	@env $(PROD_CHECK_ENV) ENDGAME_DEV_LOGIN=true ASPNETCORE_ENVIRONMENT=Development docker compose -f docker-compose.prod.yml config control-plane \
		| grep -q 'ENDGAME_DEV_LOGIN: "false"' \
		|| { echo "prod-config: the production control plane could enable the development sign-in" >&2; exit 1; }
	@if env $(PROD_CHECK_ENV) ENDGAME_DEV_LOGIN=true ASPNETCORE_ENVIRONMENT=Development docker compose -f docker-compose.prod.yml config \
		| grep 'ASPNETCORE_ENVIRONMENT:' | grep -qv 'Production'; then \
		echo "prod-config: a production service does not run as Production" >&2; exit 1; fi
	@echo "prod-config: parses; development sign-in pinned off; every service Production."

# ---------------------------------------------------------------------------------------------
# The merged stack's acceptance test: a SECOND stack (its own project name, host ports, subnet
# pool and fresh volumes) beside any `make up` stack, driven end to end through its real Edge by
# Playwright and HTTP with no mocks (src/frontend/tests-stack/), then the app kit's browser proof
# against that same Edge. `make e2e-stack` always tears the stack down afterwards, with every
# Docker resource its Dock created; `make stack-up` + `make e2e-stack-run` leave it running.
STACK_PROJECT ?= endgame-int
STACK_EDGE_PORT ?= 18095
STACK_POSTGRES_PORT ?= 15446
STACK_MAIL_PORT ?= 18026
STACK_DOCK_PORT ?= 18096
STACK_SUBNET_POOL ?= 10.215.0.0/16
STACK_PW_PORT ?= 47390
STACK_STATE = $(CURDIR)/.tmp/e2e-stack
# The test stack's own throwaway secrets: never the developer's .env values.
STACK_SERVICE_TOKEN ?= endgame_int_stack_service_token_0001
STACK_ENV = ENDGAME_SERVICE_TOKEN=$(STACK_SERVICE_TOKEN) ENDGAME_VAULT_MASTER_KEY= DOCK_SECRET_KEY= POSTGRES_PASSWORD= \
	COMPOSE_PROJECT_NAME=$(STACK_PROJECT) EDGE_HOST_PORT=$(STACK_EDGE_PORT) POSTGRES_HOST_PORT=$(STACK_POSTGRES_PORT) \
	MAIL_UI_HOST_PORT=$(STACK_MAIL_PORT) DOCK_HOST_PORT=$(STACK_DOCK_PORT) DOCK_SUBNET_POOL=$(STACK_SUBNET_POOL) \
	ENDGAME_CONTROL_PLANE_ENVIRONMENT=Development ENDGAME_DEV_LOGIN=true ENDGAME_OPERATORS=operator@endgame.localhost \
	ENDGAME_USAGE_REPORT_SECONDS=10 OPENROUTER_API_KEY=
STACK_COMPOSE = $(STACK_ENV) docker compose -f docker-compose.yml -f docker-compose.e2e.yml

stack-up: .env appkit-vendor
	$(STACK_COMPOSE) up -d --build --wait

# The stack's own images, volumes and network go with it; everything its Dock made is labelled
# endgame.dock=$(STACK_PROJECT); the app images it loaded (app-<id>) are listed by the suite in
# $(STACK_STATE)/apps.
stack-down: .env
	-$(STACK_COMPOSE) down -v --remove-orphans --rmi local
	-docker ps -aq --filter label=endgame.dock=$(STACK_PROJECT) | xargs docker rm -f -v
	-docker network ls -q --filter label=endgame.dock=$(STACK_PROJECT) | xargs docker network rm
	-docker images -q --filter label=endgame.dock=$(STACK_PROJECT) | xargs docker image rm -f
	-test -f $(STACK_STATE)/apps && for app in $$(cat $(STACK_STATE)/apps); do \
		docker images --format '{{.Repository}}:{{.Tag}}' | grep "^app-$$app:" | xargs docker image rm -f; done
	-rm -f $(STACK_STATE)/apps $(STACK_STATE)/proof.env

e2e-stack: .env
	$(MAKE) stack-up
	$(MAKE) e2e-stack-run; status=$$?; $(MAKE) stack-down; exit $$status

e2e-stack-run:
	mkdir -p $(STACK_STATE)
	$(FRONTEND) CI=1 PW_PORT=$(STACK_PW_PORT) STACK_EDGE=http://localhost:$(STACK_EDGE_PORT) STACK_MAIL=http://127.0.0.1:$(STACK_MAIL_PORT) \
		STACK_DOCK=http://127.0.0.1:$(STACK_DOCK_PORT) STACK_STATE=$(STACK_STATE) STACK_PROJECT=$(STACK_PROJECT) STACK_SERVICE_TOKEN=$(STACK_SERVICE_TOKEN) \
		npx playwright test -c playwright.stack.config.ts
	. $(STACK_STATE)/proof.env && PW_PATH_URL=$$PW_PATH_URL PW_HOST_URL=$$PW_HOST_URL PW_MEMBER_EMAIL=$$PW_MEMBER_EMAIL src/appkit/proof/edge.sh

# ---------------------------------------------------------------------------------------------
# The factory's proof (`make e2e-factory`, TEST-201): an idea taken all the way to a running private
# app, for real, with LIVE models — research with web search, placement, hires, the plan, builders,
# the evaluator calling the running preview, the security review, a private publish — then the owner
# opens the app in a real browser. OPT-IN: it spends real money on OpenRouter, and stops itself once
# the credit ledger shows FAC_SPEND_STOP_USD spent. Its own stack (project endgame-fac, its own ports,
# subnet pool and fresh volumes); the only value taken from .env is OPENROUTER_API_KEY.
# `make e2e-factory` always tears the stack down; `make fac-up` + `make e2e-factory-run` leave it up.
FAC_PROJECT ?= endgame-fac
FAC_EDGE_PORT ?= 18195
FAC_POSTGRES_PORT ?= 15546
FAC_MAIL_PORT ?= 18126
FAC_DOCK_PORT ?= 18196
FAC_SUBNET_POOL ?= 10.217.0.0/16
FAC_SPEND_STOP_USD ?= 8.50
FAC_STATE = $(CURDIR)/.tmp/e2e-factory
FAC_SERVICE_TOKEN ?= endgame_fac_stack_service_token_0001
FAC_ENV = ENDGAME_SERVICE_TOKEN=$(FAC_SERVICE_TOKEN) ENDGAME_VAULT_MASTER_KEY= DOCK_SECRET_KEY= POSTGRES_PASSWORD= \
	COMPOSE_PROJECT_NAME=$(FAC_PROJECT) EDGE_HOST_PORT=$(FAC_EDGE_PORT) POSTGRES_HOST_PORT=$(FAC_POSTGRES_PORT) \
	MAIL_UI_HOST_PORT=$(FAC_MAIL_PORT) DOCK_HOST_PORT=$(FAC_DOCK_PORT) DOCK_SUBNET_POOL=$(FAC_SUBNET_POOL) \
	ENDGAME_CONTROL_PLANE_ENVIRONMENT=Development ENDGAME_DEV_LOGIN=true ENDGAME_OPERATORS=operator@endgame.localhost \
	SECONDS_PER_IDLE_MINUTE=60 ENDGAME_USAGE_REPORT_SECONDS=60
FAC_COMPOSE = $(FAC_ENV) docker compose -f docker-compose.yml -f docker-compose.e2e.yml
FAC_DRIVER = src/backend/Endgame.Harness.Bench/factory-e2e

fac-up: .env appkit-vendor
	@grep -q '^OPENROUTER_API_KEY=..*' .env || { echo "fac-up: set OPENROUTER_API_KEY in .env (the factory calls live models)" >&2; exit 1; }
	$(FAC_COMPOSE) up -d --build --wait

fac-down: .env
	-$(FAC_COMPOSE) down -v --remove-orphans --rmi local
	-docker ps -aq --filter label=endgame.dock=$(FAC_PROJECT) | xargs docker rm -f -v
	-docker network ls -q --filter label=endgame.dock=$(FAC_PROJECT) | xargs docker network rm
	-docker images -q --filter label=endgame.dock=$(FAC_PROJECT) | xargs docker image rm -f
	-test -f $(FAC_STATE)/apps && for app in $$(cat $(FAC_STATE)/apps); do \
		docker images --format '{{.Repository}}:{{.Tag}}' | grep "^app-$$app:" | xargs docker image rm -f; done
	-rm -f $(FAC_STATE)/apps

e2e-factory: .env
	$(MAKE) fac-up
	$(MAKE) e2e-factory-run; status=$$?; $(MAKE) fac-down; exit $$status

e2e-factory-run:
	mkdir -p $(FAC_STATE)
	cd $(FAC_DRIVER) && npm ci --no-audit --no-fund && npx playwright install chromium
	cd $(FAC_DRIVER) && CI=1 FAC_EDGE=http://localhost:$(FAC_EDGE_PORT) FAC_STATE=$(FAC_STATE) \
		FAC_SPEND_STOP_USD=$(FAC_SPEND_STOP_USD) npx playwright test
