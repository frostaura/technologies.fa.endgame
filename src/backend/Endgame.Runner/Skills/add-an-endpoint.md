---
name: add-an-endpoint
trigger: Adding or changing an HTTP endpoint in an app's API.
---
# Adding an endpoint

In `api/<Feature>/<Feature>Endpoints.cs`, as a static `MapX(this RouteGroupBuilder api)` extension:

```csharp
var things = api.MapGroup("things").WithTags("Things");
things.MapPost("", CreateAsync)
    .RequireUser()                      // only when signing in is required; then take `EndgameUser user`
    .WithName("createThing")            // lowerCamelCase, unique: it becomes an MCP tool
    .WithSummary("Create a thing")
    .WithDescription("What it does, what is required, and what it returns, in a sentence or two.");
```

- Handlers are `private static async Task<...>` returning `TypedResults` (`Ok`, `Created`, `NoContent`) or
  `Results<Ok<T>, ProblemHttpResult>`; a missing thing is
  `TypedResults.Problem(statusCode: 404, title: "No such thing", detail: $"There is no thing with id {id}.")`.
- Request records carry DataAnnotations (`[property: Required, StringLength(Thing.NameMax, MinimumLength = 1)]`);
  the kit validates them before the handler runs and answers 400 field by field. Do not re-validate by hand.
- `Created` locations are relative to the request: `TypedResults.Created($"things/{thing.Id}", dto)`.
- Record a business event with `IEndgameTelemetry.Track("thing.created", ...)` when it matters.
- Never return an entity; return a record (`ThingSummary`, `ThingDetail`).
- Map it in `api/Program.cs`. The app refuses to start without a name and description on every endpoint;
  the message says what to add.
- Test it in `api.tests/`: the success path, a refusal, and who may call it.
