# The app kit: the SDKs, the dev platform fake, the template and the both-addresses proof.
#
#   make build    SDKs build (warnings are errors), web package builds, template builds against them
#   make lint     dotnet format + ESLint + tsc, for the SDKs and the template
#   make test     SDK tests (.NET and web) and the template's own tests, against a throwaway PostgreSQL
#   make proof    the template as a container image, under a path base and at a host root, in a real browser
#   make vendor   pack the SDKs into template/vendor/ (what a new app's repository starts with)
#
# Every Docker resource this file creates is named test-appkit-* and is removed when the target ends.
# Host ports used: 55471 (test database). The proof picks its own (see proof/run.sh).
.PHONY: build lint test proof vendor pack-dotnet pack-web build-sdk build-template lint-sdk lint-template \
        test-sdk test-template test-db test-db-down clean

DOTNET ?= dotnet
DOTNET_ENV = MSBuildEnableWorkloadResolver=false DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1
SLN = Endgame.AppKit.slnx
VERSION = 0.1.0
NUGET_CACHE ?= $(HOME)/.nuget/packages
TEST_DB_PORT ?= 55471
TEST_DB_CONTAINER ?= test-appkit-pg
export ENDGAME_TEST_DATABASE ?= Host=127.0.0.1;Port=$(TEST_DB_PORT);Username=postgres;Password=appkit-test

build: build-sdk vendor build-template

build-sdk:
	$(DOTNET_ENV) $(DOTNET) build $(SLN) --nologo
	cd sdk-web && npm ci --no-audit --no-fund && npm run build

# Packages land in template/vendor/. The same version is re-packed during development, so the
# copies NuGet cached from the last pack are dropped first; otherwise restore keeps the stale one.
vendor: pack-dotnet pack-web

pack-dotnet:
	rm -rf template/vendor/nuget
	rm -rf $(NUGET_CACHE)/endgame.appkit/$(VERSION) $(NUGET_CACHE)/endgame.appkit.testing/$(VERSION) $(NUGET_CACHE)/endgame.appkit.devplatform/$(VERSION)
	for p in sdk-dotnet/Endgame.AppKit sdk-dotnet/Endgame.AppKit.Testing dev/Endgame.AppKit.DevPlatform; do \
		$(DOTNET_ENV) $(DOTNET) pack $$p -c Release --nologo || exit 1; done

pack-web:
	rm -rf template/vendor/npm && mkdir -p template/vendor/npm
	cd sdk-web && npm ci --no-audit --no-fund && npm run build && npm pack --pack-destination ../template/vendor/npm
	# Re-point the template at the fresh tarball: npm otherwise reuses the copy cached under the old integrity.
	cd template/web && npm install --no-audit --no-fund @endgame/appkit@file:../vendor/npm/endgame-appkit-$(VERSION).tgz

build-template:
	$(MAKE) -C template build

lint: lint-sdk lint-template

lint-sdk:
	$(DOTNET_ENV) $(DOTNET) format $(SLN) --verify-no-changes --verbosity minimal
	cd sdk-web && npm run lint && npm run typecheck

lint-template: vendor
	$(MAKE) -C template lint

test: test-db
	$(MAKE) test-sdk test-template; status=$$?; $(MAKE) test-db-down; exit $$status

test-sdk:
	$(DOTNET_ENV) $(DOTNET) test sdk-dotnet/Endgame.AppKit.Tests/Endgame.AppKit.Tests.csproj --nologo
	cd sdk-web && npm run test -- --run

test-template: vendor
	$(MAKE) -C template test

# A throwaway PostgreSQL on loopback, data in tmpfs. Tests create and drop their own databases on it.
test-db:
	@docker rm -f $(TEST_DB_CONTAINER) > /dev/null 2>&1 || true
	docker run -d --name $(TEST_DB_CONTAINER) -e POSTGRES_PASSWORD=appkit-test -p 127.0.0.1:$(TEST_DB_PORT):5432 \
		--tmpfs /var/lib/postgresql/data postgres:16.16-alpine > /dev/null
	@for i in $$(seq 1 30); do docker exec $(TEST_DB_CONTAINER) pg_isready -U postgres -h 127.0.0.1 > /dev/null 2>&1 && exit 0; sleep 1; done; \
		echo "test database did not become ready" >&2; exit 1

test-db-down:
	@docker rm -f $(TEST_DB_CONTAINER) > /dev/null 2>&1 || true

proof: vendor
	./proof/run.sh

clean:
	rm -rf template/vendor template/api/wwwroot
