Add borrowing to the library, across the API and the web app. Follow the conventions already in the code, and resolve anything this description leaves open by reading the code — there is nobody to ask.

API:
- `POST /api/books/{id}/borrow` puts the book on loan and returns 200 with the updated book.
- `POST /api/books/{id}/return` makes it available again and returns 200 with the updated book.
- Every book the API returns gains `isAvailable` (boolean) and `dueDate` (a date formatted `yyyy-MM-dd`, or null when the book is available). The due date is set when the book is borrowed, according to the library's loan policy.
- Borrowing a book that is already on loan, or returning one that is not, is rejected the way this API already rejects a request that conflicts with the current state of the data. An unknown id is a 404, as elsewhere.
- Loan state is stored in the database, with an EF Core migration.

Web app:
- Each book in the list shows `Available` or `On loan until <dueDate>`, and a button labelled `Borrow` or `Return` that calls the matching endpoint and then shows that book as the API returned it.
- This is verified by rendering `App` with `fetch` mocked, so keep calling the API through `src/api.ts` with `fetch`.

All existing tests must still pass; add tests for the new behaviour.
