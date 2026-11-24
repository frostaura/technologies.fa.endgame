---
name: write-a-screen
trigger: Writing or changing a front-end page or form in an app, with its four states and its tests.
---
# Writing a screen

Copy `web/src/notes/NotesPage.tsx` and its test.

- Read with `useApiQuery<T>("things")`; show **four different states**: `status === "loading"` →
  `<LoadingState label="Loading things…" />`; `"failed"` → `<FailedState error={q.error} onRetry={q.reload} />`;
  loaded and empty → `<EmptyState title="No things yet">what to do next</EmptyState>`; loaded → the content.
  A failed read is never shown as empty.
- Write with `api("things", { method: "POST", body })`; it throws `ValidationError` (show `errors` beside each
  field), `NotSignedInError` (go to its `signInUrl`), `NotFoundError` and `BudgetExhaustedError`.
- Primitives from `@endgame/appkit/ui` (`Button`, `Card`, `Input`, …); classes only from the token layer
  (`bg-surface`, `text-ink-muted`, `text-primary`, `shadow-raised`). No hex colours, no arbitrary values such as
  `p-[13px]`, no fonts or scripts from other hosts.
- No URL starts with `/` except router paths in `<Link to>` and `<Route path>`; the router adds the base.
- Use the width on large screens: grids such as `sm:grid-cols-2 xl:grid-cols-3`, never one narrow column.
- Pages other than the first are `lazy()` in `App.tsx`.
- Test each state with Vitest and Testing Library, mocking `fetch` (see `NotesPage.test.tsx`): loading, empty,
  loaded (check the links' `href`), failed (an alert with the reason, never the empty text).
