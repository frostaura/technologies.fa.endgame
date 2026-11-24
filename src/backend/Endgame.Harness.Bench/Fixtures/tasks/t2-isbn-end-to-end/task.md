Add an optional ISBN to books, end to end:

1. Store it in the database: add it to the `Book` entity and create an EF Core migration for it (the app applies migrations at startup).
2. Accept it when creating a book, as `isbn` in the `POST /api/books` body. It is optional; a missing, empty or whitespace-only value is stored as null, and a present value is trimmed.
3. Return it from every book endpoint as `isbn` (null when the book has none).
4. In the web app, the book list shows `ISBN: <value>` for a book that has one, and shows no ISBN text at all for a book that does not.

All existing tests must still pass.
