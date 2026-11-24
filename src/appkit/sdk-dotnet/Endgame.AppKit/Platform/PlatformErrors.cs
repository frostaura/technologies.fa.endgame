using System.Net;

namespace Endgame.AppKit;

/// <summary>A platform service refused or failed a call. <see cref="Code"/> is stable; branch on it, never on the message.</summary>
public class EndgamePlatformException(string message, HttpStatusCode? status = null, string? code = null, Exception? inner = null)
    : Exception(message, inner)
{
    /// <summary>The HTTP status the platform answered with, or null when it could not be reached.</summary>
    public HttpStatusCode? Status { get; } = status;

    /// <summary>The platform's machine-readable reason, e.g. <c>budget_exhausted</c>, or null.</summary>
    public string? Code { get; } = code;
}

/// <summary>The platform could not be reached at all.</summary>
public sealed class EndgamePlatformUnavailableException(string message, Exception inner)
    : EndgamePlatformException(message, null, "platform_unavailable", inner);

/// <summary>The credit budget that covers this app is spent. Terminal: retrying will not help until someone tops up.</summary>
public sealed class EndgameBudgetExhaustedException(string message)
    : EndgamePlatformException(message, HttpStatusCode.PaymentRequired, "budget_exhausted");

/// <summary>No secret with this name is set at any level of the app's cascade.</summary>
public sealed class EndgameSecretNotFoundException(string name, string message)
    : EndgamePlatformException(message, HttpStatusCode.NotFound, "secret_not_found")
{
    /// <summary>The name that was asked for.</summary>
    public string Name { get; } = name;
}
