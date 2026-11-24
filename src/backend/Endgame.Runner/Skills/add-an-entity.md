---
name: add-an-entity
trigger: Adding a new kind of thing an app stores, end to end: entity, database, API, screen and tests.
---
# Adding an entity end to end

Copy the shape of the template's Notes feature (`api/Notes/`, `web/src/notes/`). In order:

1. **Entity** — `api/<Things>/<Thing>.cs`: a sealed class with `Guid Id { get; init; } = Guid.CreateVersion7();`,
   `required` properties, `const` length limits, and an `IEntityTypeConfiguration<Thing>` in the same file
   (`ToTable("things")`, `HasKey`, `HasMaxLength` from the consts, indexes for what lists sort by). Store an
   owner as `EndgameUser.Id`, never an email.
2. **DbSet** — add `public DbSet<Thing> Things => Set<Thing>();` to `api/Data/AppDb.cs`.
3. **Migration** — load the `write-a-migration` skill and follow it.
4. **Endpoints** — load the `add-an-endpoint` skill: list, read, create (and update or delete only if asked),
   mapped from `Program.cs` with `api.MapThings();`.
5. **API tests** — `api.tests/ThingsApiTests.cs` with `IClassFixture<EndgameAppFactory<Program>>`: create then
   list and read back; refused input field by field (400); signed-in-only writes give 401.
6. **Types** — `web/src/<things>/types.ts` mirroring the summary and detail records exactly.
7. **Screens** — load the `write-a-screen` skill: a list page and, if there is one, a detail and a form.
8. **Route** — add the routes in `web/src/App.tsx` (lazy for pages after the first).
9. **Docs** — say what the entity is in `docs/data.md`.
10. Run `make lint` and `make test`; fix every failure; commit.
