Add `GET /api/books/{id}/summary`, returning `{ "title", "author", "age" }` for the book, where `age` is the number of whole years since its publication year, counted from the current year.

An unknown id is a 404 in the way this API already reports one. Add an xUnit test. All tests must pass.

An evaluator will check your work when you finish and may require more; if it does, you will be told exactly what.
