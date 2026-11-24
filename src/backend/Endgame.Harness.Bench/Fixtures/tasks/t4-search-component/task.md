Add client-side search to the web app's book list.

- Create `web/src/components/BookSearch.tsx` with a named export `BookSearch` taking `{ books: Book[] }`.
- It renders a text input with the accessible label `Search books`, a status line `Showing N of M books` (N matching, M total), and the existing `BookList` with only the matching books.
- A book matches when its title or author contains the search text, case-insensitively, ignoring leading and trailing spaces in the search text. An empty search matches everything.
- When nothing matches, show `No books match "<search text as typed, trimmed>".` instead of the list.
- Use `BookSearch` in `App` in place of `BookList`.
- Add a Vitest test for the component. `npm run build` and `npm test` must pass.
