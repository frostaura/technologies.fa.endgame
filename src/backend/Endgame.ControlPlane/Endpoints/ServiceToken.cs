using System.Security.Cryptography;
using System.Text;
using Endgame.Application.Common;

namespace Endgame.ControlPlane.Endpoints;

/// <summary>
/// Guards <c>/internal/*</c>: the caller must present <c>ENDGAME_SERVICE_TOKEN</c> as a bearer token
/// (ARCH-004). With no token configured, nothing internal is reachable at all.
/// </summary>
internal sealed class ServiceTokenFilter(IConfiguration configuration) : IEndpointFilter
{
    public const string ConfigurationKey = "ENDGAME_SERVICE_TOKEN";

    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(next);
        var expected = configuration[ConfigurationKey];
        if (string.IsNullOrEmpty(expected))
        {
            return Problems.From(new EndgameProblem(503, "service_token_unconfigured", "Internal API unavailable",
                $"{ConfigurationKey} is not configured, so no service can call the internal API."));
        }

        var header = context.HttpContext.Request.Headers.Authorization.ToString();
        var given = header.StartsWith("Bearer ", StringComparison.Ordinal) ? header["Bearer ".Length..].Trim() : "";
        var a = SHA256.HashData(Encoding.UTF8.GetBytes(given));
        var b = SHA256.HashData(Encoding.UTF8.GetBytes(expected));
        if (given.Length == 0 || !CryptographicOperations.FixedTimeEquals(a, b))
        {
            return Problems.From(new EndgameProblem(401, "invalid_service_token", "Service token required",
                "Internal endpoints need the service token in the Authorization header."));
        }

        return await next(context);
    }
}
