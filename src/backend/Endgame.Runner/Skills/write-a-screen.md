---
name: write-a-screen
trigger: Writing or changing a front-end page or form in an app, with its four states, its test ids and its tests.
---
# Writing a screen

Copy `web/src/notes/NotesPage.tsx` and its test, and `web/src/App.test.tsx` for navigation.

- Read with `useApiQuery<T>("things")`; show **four different states**: `status === "loading"` →
  `<LoadingState label="Loading things…" />`; `"failed"` → `<FailedState error={q.error} onRetry={q.reload} />`;
  loaded and empty → `<EmptyState title="No things yet">what to do next</EmptyState>`; loaded → the content.
  A failed read is never shown as empty.
- Write with `api("things", { method: "POST", body })`; it throws `ValidationError` (show `errors` beside each
  field), `NotSignedInError` (go to its `signInUrl`), `NotFoundError` and `BudgetExhaustedError`.
- After a write through `api()` succeeds, **every `useApiQuery` on screen re-reads by itself**, keeping its data
  shown while it does (a failed re-read shows as failed). Do not call other lists' `reload()` or pass refresh
  callbacks between components; a "Reading now" list drops a book marked finished without any code of its own.
- Read the address from the router — `useParams()` for `:id`, `useSearchParams()` for `?court=…`,
  `useLocation()` for the rest — never `window.location.search`, `.hash` or `.pathname`: they do not change when
  a `<Link>` moves to the page, so the address changes and the page does not appear. ESLint
  (`endgame/no-location-read`) fails it. `location.assign(signInUrl())` to leave the app is fine.
- Primitives from `@endgame/appkit/ui` (`Button`, `Card`, `Input`, …); classes only from the token layer
  (`bg-surface`, `text-ink-muted`, `text-primary`, `shadow-raised`). No hex colours, no arbitrary values such as
  `p-[13px]`, no fonts or scripts from other hosts.
- No URL starts with `/` except router paths in `<Link to>` and `<Route path>`; the router adds the base.
- Dates and numbers only through `formatDate`, `formatDateTime` and `formatNumber` from `@endgame/appkit`, which never throw
  (ESLint `endgame/no-unsafe-format` fails `toLocaleString` and `Intl.DateTimeFormat(…).format`): the browser's formatters throw
  on a date a field lets through — a six-digit year — and a throw blanks the page. Every date or number input carries `min` and
  `max`, and the form checks what was typed on submit (`checkDateInput`, `checkNumberInput`) with the error beside the field.
- Use the width on large screens: grids such as `sm:grid-cols-2 xl:grid-cols-3`, never one narrow column.
- Pages other than the first are `lazy()` in `App.tsx`.

## Test ids — exactly these forms

`<entity>` is the singular noun in kebab-case (`book`, `court-booking`); `<view>` a page's name in kebab-case;
`<field>` the API field in kebab-case; `<value>` an enum value in kebab-case (`WantToRead` → `want-to-read`).

| Test id | On |
| --- | --- |
| `page-<view>` | each page's root element, in every state; the first page is `page-home` |
| `nav-<view>` | each link (or tab) in the app's navigation to that page |
| `<entity>-list` | the element holding a list of them — also when empty (wrap the empty state in it) |
| `<entity>-item` | each item of a list, plus `data-id="<the item's id>"` |
| `new-<entity>` | the link or button that opens the form to add one |
| `open-<entity>` | inside an item, the link to its own page |
| `<entity>-<field>` | each form input, with a visible `<label>` and `name="<api field>"` |
| `save-<entity>` | the form's submit button |
| `set-<field>-<value>` | a button that sets one field to one value (`set-status-finished`), on an item or its page |

Write each as a literal `data-testid="…"` attribute, never built from a template string; the item's own id goes
in `data-id`, never in the test id. The plan item names the test ids its screens carry, and the factory checks that
each one exists in `web/src` as `data-testid="…"`; a missing one fails the item.

## Tests

- Test each state with Vitest and Testing Library, mocking `fetch` (`jsonResponse` from
  `@endgame/appkit/testing`; see `NotesPage.test.tsx`): loading, empty, loaded (check the links' `href`), failed
  (an alert with the reason, never the empty text). Select by test id: `getByTestId("book-item")`.
- **Every form field holds up against bad input, and has the test that proves it.** For each input, select and textarea
  a form carries (its `<entity>-<field>` test id), one test titled exactly `holds up against bad input: <test id>`, written
  with the kit's helper — `it.each(["dive-site", "dive-when"])(BAD_INPUT_TEST, (field) => holdsUpAgainstBadInput(field, { render:
  renderPage, page: "page-new-dive", submit: "save-dive" }))` from `@endgame/appkit/testing` (see `NewNotePage.test.tsx`). It
  feeds the field what a person can put there — a six-digit year in a date (a browser keeps one typed into the year segment),
  a date before any sane limit, a number far past any, an option that is not there, a blank required field, text past its
  `maxLength` — and fails unless the page stays on screen and, on submit, refuses each beside the field (`aria-invalid` and the
  error its `aria-describedby` names) before anything is sent. The factory runs the app's tests itself and fails a part whose
  form field has no such passing test. Make the page pass it — bounded fields, a check on submit, formatting through the kit
  — never weaken the test.
- **Every link or button that moves between pages has a navigation test** in `App.test.tsx`: render the real app
  with `renderApp(<App />, { at: "/" })`, click it (`fireEvent.click(await screen.findByTestId("new-book"))`), and
  find the page it lands on (`await screen.findByTestId("page-new-book")`) with its form. Loading the address
  directly is not enough: that passes while the link is broken.
