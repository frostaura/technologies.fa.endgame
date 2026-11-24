# Library — fixture app

A small lending-library app used as the harness spike's benchmark fixture.

- `src/Library.Api` — .NET 10 minimal API, EF Core on SQLite, migrations applied at startup.
- `tests/Library.Api.Tests` — xUnit tests (API tests boot the app on a throwaway database).
- `web/` — Vite + React + TypeScript front end, tested with Vitest and Testing Library.

Commands (from the repository root):

    dotnet build Library.slnx
    dotnet test Library.slnx
    dotnet ef migrations add <Name> --project src/Library.Api
    cd web && npm run build && npm test
