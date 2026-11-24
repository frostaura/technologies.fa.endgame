namespace Endgame.Application.Email;

/// <summary>One message ready to hand to the mail server. Addresses are already validated.</summary>
public sealed record OutgoingEmail(
    IReadOnlyList<string> To,
    string Subject,
    string Text,
    string? Html,
    string? ReplyTo,
    string FromDisplayName,
    string MessageId);

/// <summary>
/// Port: the one way mail leaves Endgame. With nothing configured, <see cref="IsConfigured"/> is false
/// and nothing is ever sent — messages wait in the outbox instead.
/// </summary>
public interface IEmailSender
{
    bool IsConfigured { get; }

    /// <summary>Sends, or throws. A failure is retried by the dispatcher with back-off.</summary>
    Task SendAsync(OutgoingEmail email, CancellationToken cancellationToken);
}
