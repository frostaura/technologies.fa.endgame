using Endgame.Hosting.Contracts;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;

namespace Endgame.Dock.Api;

/// <summary>A failure the caller can act on, returned as problem details with a stable <c>code</c>.</summary>
public sealed class DockProblem(int status, string code, string title, string? detail = null) : Exception(detail ?? title)
{
    public int Status { get; } = status;

    public string Code { get; } = code;

    public string Title { get; } = title;

    public string? Detail { get; } = detail;

    public static DockProblem Invalid(string detail) => new(StatusCodes.Status400BadRequest, DockProblemCodes.Invalid, "The request is not valid.", detail);

    public static DockProblem NotFound(string what) => new(StatusCodes.Status404NotFound, DockProblemCodes.NotFound, $"{what} was not found.");

    public static DockProblem Exists(string what) => new(StatusCodes.Status409Conflict, DockProblemCodes.AlreadyExists, $"{what} already exists.");

    public static DockProblem ProtectedPath(string detail) => new(StatusCodes.Status403Forbidden, DockProblemCodes.ProtectedPath, "That path is protected.", detail);

    public static DockProblem Unavailable(string detail) => new(StatusCodes.Status503ServiceUnavailable, DockProblemCodes.Unavailable, "A dependency did not answer.", detail);
}

/// <summary>Turns a <see cref="DockProblem"/> — or anything unexpected — into problem details.</summary>
public sealed class DockProblemHandler(IProblemDetailsService problems, ILogger<DockProblemHandler> logger) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext httpContext, Exception exception, CancellationToken cancellationToken)
    {
        var problem = exception as DockProblem;
        if (problem is null)
        {
            if (exception is OperationCanceledException && httpContext.RequestAborted.IsCancellationRequested)
            {
                return true;
            }

            logger.LogError(exception, "Unhandled failure on {Method} {Path}.", httpContext.Request.Method, httpContext.Request.Path);
            problem = new DockProblem(StatusCodes.Status500InternalServerError, "internal_error", "Dock failed unexpectedly.");
        }

        httpContext.Response.StatusCode = problem.Status;
        var details = new ProblemDetails
        {
            Status = problem.Status,
            Title = problem.Title,
            Detail = problem.Detail,
            Type = $"https://endgame.frostaura.net/problems/{problem.Code}",
            Extensions = { ["code"] = problem.Code },
        };
        return await problems.TryWriteAsync(new ProblemDetailsContext { HttpContext = httpContext, ProblemDetails = details, Exception = exception });
    }
}
