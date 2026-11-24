using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

namespace Endgame.AppKit;

/// <summary>Turns platform failures into problem-details responses a front end can tell apart.</summary>
internal sealed partial class EndgameExceptionHandler(IProblemDetailsService problems, ILogger<EndgameExceptionHandler> logger) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext context, Exception exception, CancellationToken cancellationToken)
    {
        if (exception is not EndgamePlatformException platform)
        {
            return false;
        }

        LogPlatformFailure(logger, platform.Code ?? "unknown", platform.Message);
        var (status, title) = platform switch
        {
            EndgameBudgetExhaustedException => (StatusCodes.Status402PaymentRequired, "The credit budget is spent"),
            EndgamePlatformUnavailableException => (StatusCodes.Status503ServiceUnavailable, "A platform service is unavailable"),
            _ => (StatusCodes.Status502BadGateway, "A platform service failed"),
        };
        context.Response.StatusCode = status;
        return await problems.TryWriteAsync(new ProblemDetailsContext
        {
            HttpContext = context,
            Exception = exception,
            ProblemDetails =
            {
                Status = status,
                Title = title,
                Detail = platform is EndgameBudgetExhaustedException ? "This feature is paused until the organisation tops up its credits." : null,
                Extensions = { ["code"] = platform.Code },
            },
        });
    }

    [LoggerMessage(Level = LogLevel.Error, Message = "Platform call failed ({Code}): {Reason}")]
    private static partial void LogPlatformFailure(ILogger logger, string code, string reason);
}
