Add an endpoint to update a book: `PUT /api/books/{id}`, taking the same JSON body as create (`title`, `author`, `year`).

- 200 with the updated book (same shape as the other endpoints return) on success. Title and author are trimmed, as on create.
- 404 if no book has that id.
- 400 if the title or author is missing or blank, or if the year is not between 1450 and the current year inclusive.
- 409 if a *different* book already has the same title and author.

Errors use the API's existing error body and the same error codes the existing endpoints use for the same situations. Add xUnit tests covering the new endpoint. All tests must pass.
