# The contract: `make build`, `make test`, `make lint`. Also `make image` and `make migration name=AddThing`.
#
# MSBuildEnableWorkloadResolver=false keeps restore working on machines with a broken .NET workload
# set; it is harmless everywhere else.
.PHONY: build test lint image migration web-deps

DOTNET ?= dotnet
DOTNET_ENV = MSBuildEnableWorkloadResolver=false DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1

web/node_modules/.package-lock.json: web/package.json web/package-lock.json
	cd web && npm ci --no-audit --no-fund

web-deps: web/node_modules/.package-lock.json

# Front end into api/wwwroot, then the API. Warnings fail the build on both sides.
build: web-deps
	cd web && npm run build
	$(DOTNET_ENV) $(DOTNET) build App.slnx --nologo

# Needs ENDGAME_TEST_DATABASE: a PostgreSQL server the tests may create and drop databases on.
test: build
	cd web && npm run test -- --run
	$(DOTNET_ENV) $(DOTNET) test App.slnx --nologo --no-build

lint: web-deps
	cd web && npm run lint && npm run typecheck
	$(DOTNET_ENV) $(DOTNET) format App.slnx --verify-no-changes --verbosity minimal

# The container image the platform runs: front end built in, ReadyToRun, chiseled base.
image: web-deps
	$(DOTNET_ENV) $(DOTNET) publish api/App.Api.csproj /t:PublishContainer --nologo

# A schema change: `make migration name=AddTagsToNotes`. Never edit a migration once it has run.
migration:
	@test -n "$(name)" || { echo "usage: make migration name=AddSomething" >&2; exit 1; }
	$(DOTNET_ENV) $(DOTNET) tool restore
	$(DOTNET_ENV) $(DOTNET) ef migrations add $(name) --project api --output-dir Migrations
