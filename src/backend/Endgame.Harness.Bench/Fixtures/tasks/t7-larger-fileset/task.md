The library's genres live in `src/Library.Api/Genres/`: one class per genre, each implementing `IGenre`. `GenreRegistry` was started by hand and is out of date.

Add `GET /api/genres`, returning every genre the library offers as a JSON array of `{ "code", "name", "maxLoanDays" }`, sorted by `code`.

- Every genre class in that folder must be included, except retired ones (`Retired` is true), which must not appear.
- Make `GenreRegistry.All` list exactly those offered genres too, so nothing else in the app can drift from the endpoint.
- Add an xUnit test for the endpoint. All tests must pass.
