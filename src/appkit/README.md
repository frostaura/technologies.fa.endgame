# The app kit

What every Endgame app is built from: a template and the library it is built against.

| Path | What |
| --- | --- |
| `sdk-dotnet/Endgame.AppKit` | The .NET library: `AddEndgameApp<TDb>()` / `UseEndgameApp()` and the typed platform clients. |
| `sdk-dotnet/Endgame.AppKit.Testing` | For an app's tests: the app in memory, a throwaway database, the dev platform. |
| `sdk-web` | `@endgame/appkit`: `api()`, `routerBasename()`, `useCurrentUser()`, the token layer, primitives, the ESLint rule. |
| `template` | The starting app (Notes). Its `AGENTS.md` is what the builder reads. |
| `dev` | **Test double** of the platform (API, egress proxy, edge). Never deployed. |
| `proof` | The template's image in a real browser, under a path base and at a host root. |
| `PLATFORM-API.md` | The contract with Dock, Edge and the control plane. |

`make build`, `make lint`, `make test`, `make proof` — see the `Makefile` header. Test plan:
`docs/testing/TEST-050-app-kit.md`.
