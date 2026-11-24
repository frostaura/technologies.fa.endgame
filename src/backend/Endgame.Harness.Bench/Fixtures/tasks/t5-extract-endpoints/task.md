Refactor the API without changing its behaviour.

- Move the book endpoint definitions out of `Program.cs` into a static class `BookEndpoints` in `src/Library.Api/Endpoints/BookEndpoints.cs`, namespace `Library.Api.Endpoints`.
- It exposes a public extension method `MapBookEndpoints(this IEndpointRouteBuilder app)` that registers the endpoints on a route group for `/api/books`, and returns the `IEndpointRouteBuilder` it was given.
- Each endpoint's handler becomes a named private or internal static method of `BookEndpoints` rather than an inline lambda.
- `Program.cs` calls `app.MapBookEndpoints();` and itself contains no `MapGet`, `MapPost` or other `Map*` endpoint registrations.
- Routes, status codes and bodies stay exactly as they are. The existing tests must pass unchanged — do not edit them.
