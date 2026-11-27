---
name: write-a-migration
trigger: Changing an app's database schema: a new entity, column, index or constraint.
used-by: builders
---
# Writing a migration

1. Change the entity and its configuration first, and add the `DbSet` if the entity is new.
2. Build: `make build` must pass before a migration can be generated.
3. Generate: `make migration name=AddThings` (PascalCase, saying what changes). This runs `dotnet ef`
   from the app's tool manifest; never install tools.
4. Read the generated `api/Migrations/<timestamp>_AddThings.cs`: it must do exactly the change you meant,
   with no drops you did not intend. If it is wrong, fix the model and regenerate. Never edit a migration
   by hand, and never edit one that has been committed — add another.
5. Migrations run when the app starts; the tests run them against a throwaway database, so `make test`
   proves the migration applies.
6. Commit the migration together with the model change that needs it.
