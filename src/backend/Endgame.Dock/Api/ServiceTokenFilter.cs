using System.Security.Cryptography;
using System.Text;
using Endgame.Hosting.Contracts;

namespace Endgame.Dock.Api;

/// <summary>
/// Every <c>/internal</c> call carries <c>Authorization: Bearer $ENDGAME_SERVICE_TOKEN</c>
/// (ARCH-004). Compared in constant time; with no token configured, every call is refused.
/// </summary>
public sealed class ServiceTokenFilter(IConfiguration configuration) : IEndpointFilter
{
    private readonly byte[]? expected = configuration[HostingConventions.ServiceTokenVariable] is { Length: >= 16 } token
        ? SHA256.HashData(Encoding.UTF8.GetBytes(token))
        : null;

    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var header = context.HttpContext.Request.Headers.Authorization.ToString();
        var prefix = HostingConventions.ServiceTokenScheme + " ";
        var presented = header.StartsWith(prefix, StringComparison.Ordinal) ? header[prefix.Length..] : "";
        if (expected is null || !CryptographicOperations.FixedTimeEquals(expected, SHA256.HashData(Encoding.UTF8.GetBytes(presented))))
        {
            throw new DockProblem(StatusCodes.Status401Unauthorized, DockProblemCodes.Unauthorized, "A valid service token is required.");
        }

        return await next(context);
    }
}
