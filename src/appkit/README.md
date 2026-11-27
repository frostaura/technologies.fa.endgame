# The app kit

What every Endgame app is built from: a template and the library it is built against.

| Path | What |
| --- | --- |
| `sdk-dotnet/Endgame.AppKit` | The .NET library: `AddEndgameApp<TDb>()` / `UseEndgameApp()` and the typed platform clients. |
| `sdk-dotnet/Endgame.AppKit.Testing` | For an app's tests: the app in memory, a throwaway database, the dev platform. |
| `sdk-web` | `@endgame/appkit`: `api()`, `useApiQuery()`, `routerBasename()`, `useCurrentUser()`, the token layer, primitives, the ESLint rules (`/eslint`), test helpers (`/testing`). |
| `template` | The starting app (Notes). Its `AGENTS.md` is what the builder reads. |
| `dev` | **Test double** of the platform (API, egress proxy, edge). Never deployed. |
| `proof` | The template's image in a real browser, under a path base and at a host root. |
| `PLATFORM-API.md` | The contract with Dock, Edge and the control plane. |

What the web SDK does for every app, so no app has to:

- **Reads follow writes.** After a successful `api()` call that is not a GET, every mounted
  `useApiQuery` re-reads, keeping its data on screen meanwhile; a failed re-read shows as failed.
- **The address comes from the router.** `endgame/no-root-relative-url` fails a URL starting with
  `/`; `endgame/no-location-read` fails reading `window.location` (use `useParams`,
  `useSearchParams`, `useLocation`), since a page that reads it is not re-rendered by a `<Link>`.
- **Navigation is testable.** `renderApp(<App />, { at: "/", base? })` from `@endgame/appkit/testing`
  renders the real app with a router based on the page's `<base>`; `jsonResponse()` and
  `setBase()` are there too.
- **A page that breaks never blanks the app.** `AppErrorBoundary` (from `/ui`) shows "Something went
  wrong on this page" with "Try again" and "Back to the start", keeping the header; the template mounts it
  at the root and around the routed page, and `createRoot(root, rootOptions)` leaves its one report the only one.
- **Screens are predictable.** Every app uses the same `data-testid` forms (`page-<view>`,
  `<entity>-item`, `save-<entity>`, …), listed in `template/AGENTS.md`.

`make build`, `make lint`, `make test`, `make proof` — see the `Makefile` header. Test plan:
`docs/testing/TEST-050-app-kit.md`.
