---
name: write-a-screen
trigger: Writing or changing a front-end page or form in an app, with the kit's page layouts, its four states, its test ids and its tests.
---
# Writing a screen

Copy the Notes page that has the shape you need — the list (`web/src/notes/NotesPage.tsx`), the form (`NewNotePage.tsx`) or the
record (`NoteDetailPage.tsx`) — and its test, and `web/src/App.test.tsx` for navigation. Follow **What good looks like** in
`AGENTS.md`; its checklist is the bar, and `web/src/pageShapes.test.tsx` fails the build below it.

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
- Build the page from the kit's layouts in `@endgame/appkit/ui`, never bare `div`s:
  - every page: `PageHeader` (one `<h1>`, a line on what it is, its actions; `back={<Link to="/">All dives</Link>}` below the
    first page) and `PageLayout aside={…}` — a side panel beside the page on a desktop, under it on a phone;
  - a list: `CardGrid` of `ItemCard`s (they fill the width: one column on a phone, three or four on a desktop) or a table, with a
    summary `Panel` of `Facts` beside it; a status is a `Badge` in one of five tones (`neutral`, `info`, `good`, `warn`, `bad`);
  - a form: `PageLayout form aside={preview or help}`, the fields in `FormCard`, each a `Field` around `Input`, `Select`,
    `Textarea` or `Checkbox` (a raw `<input>` has a faint 1.2:1 edge; ESLint `endgame/use-kit-fields` refuses it), and
    `FormActions` with the main action and **Cancel** (`cancel={<Link to="/">Cancel</Link>}`);
  - a record: its facts in a `Panel` beside it; things to tick as a `Checklist` of `ChecklistItem`s with a `Progress`; a link
    to share as `CopyLink`; a status (`Badge`) and its action (a `Button`, `variant="danger"` when it removes) kept apart;
  - nothing at an address: `NotFoundState` with a way back; nothing in a list: `EmptyState` with the action that fills it.
- The header is the kit's `AppHeader` in `App.tsx` — the app's name (`APP_NAME`, which is the platform's name for the app),
  navigation as `NavItem`s, who is signed in and "Sign out". Never add another header, title or sign-out to a page, and never
  write the app's name anywhere but `appName.ts`.
- Classes only from the token layer (`bg-surface`, `text-ink-muted`, `text-primary`, `shadow-raised`). No hex colours, no
  arbitrary values such as `p-[13px]`, no fonts or scripts from other hosts.
- No URL starts with `/` except router paths in `<Link to>` and `<Route path>`; the router adds the base.
- Dates and numbers only through `formatDate`, `formatDateTime` and `formatNumber` from `@endgame/appkit`, which never throw
  (ESLint `endgame/no-unsafe-format` fails `toLocaleString` and `Intl.DateTimeFormat(…).format`): the browser's formatters throw
  on a date a field lets through — a six-digit year — and a throw blanks the page. Every date or number input carries `min` and
  `max`, and the form checks what was typed on submit (`checkDateInput`, `checkNumberInput`) with the error beside the field.
- On a phone: one column, nothing wider than the screen, every control at least 44 px (the kit's are), the main action full
  width, and the side panel after the page — never hidden.
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

- **Every page has a row in `web/src/pageShapes.test.tsx`** — `{ at: "/dives/new", page: "page-new-dive", kind: "form", ready:
  "dive-site" }` — which renders it with its data and runs the kit's `expectPageShape`: one `<h1>`; kit fields only; a list that
  may use at least 60% of a 1440 px desktop and is more than one column there; a form with a submit and "Cancel"; a record
  with a way back. Fix the page, never the row.
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
