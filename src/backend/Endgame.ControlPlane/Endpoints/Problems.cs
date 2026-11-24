using Endgame.Application.Common;
using Endgame.Domain;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;

namespace Endgame.ControlPlane.Endpoints;

/// <summary>
/// One place that turns a refusal into problem details (RFC 9457). Every error the API returns has a
/// status, a stable <c>type</c> ending in a machine-readable code, and a sentence for a person, so a
/// failed read is never confused with an empty one.
/// </summary>
internal static class Problems
{
    public const string TypeBase = "https://endgame.frostaura.net/problems/";

    public static IResult From(EndgameProblem problem)
    {
        var details = new ProblemDetails
        {
            Status = problem.Status,
            Type = TypeBase + problem.Code,
            Title = problem.Title,
            Detail = problem.Detail,
        };
        details.Extensions["code"] = problem.Code;
        foreach (var (key, value) in problem.Extensions)
        {
            details.Extensions[key] = value;
        }

        return Results.Problem(details);
    }

    public static IResult Invalid(string detail) => From(EndgameProblem.Invalid(detail));

    /// <summary>Renders anything thrown below an endpoint. An unexpected exception becomes a 500 with no internals.</summary>
    public static void UseEndgameProblems(this WebApplication app)
    {
        app.UseExceptionHandler(handler => handler.Run(async context =>
        {
            var error = context.Features.Get<IExceptionHandlerFeature>()?.Error;
            var problem = error switch
            {
                EndgameProblem p => p,
                DomainException d => EndgameProblem.Invalid(d.Message),
                BadHttpRequestException b => new EndgameProblem(b.StatusCode, "invalid_request", "The request could not be read", b.Message),
                _ => new EndgameProblem(500, "internal_error", "Something went wrong", "The control plane failed to handle this request. It has been logged."),
            };
            if (problem.Status >= 500)
            {
                context.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("Endgame.Problems")
                    .LogError(error, "Unhandled failure on {Method} {Path}", context.Request.Method, context.Request.Path);
            }

            await From(problem).ExecuteAsync(context);
        }));
        app.UseStatusCodePages(async status =>
        {
            var response = status.HttpContext.Response;
            if (response.HasStarted || response.ContentLength is > 0 || response.ContentType is not null)
            {
                return;
            }

            var problem = response.StatusCode switch
            {
                401 => EndgameProblem.Unauthenticated(),
                403 => EndgameProblem.Forbidden("You may not do this."),
                404 => new EndgameProblem(404, "not_found", "Not found", "There is nothing at this address."),
                405 => new EndgameProblem(405, "method_not_allowed", "Method not allowed", "This address does not accept that method."),
                _ => new EndgameProblem(response.StatusCode, "error", "The request failed"),
            };
            await From(problem).ExecuteAsync(status.HttpContext);
        });
    }
}
