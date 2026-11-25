using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Endgame.Application.Common;
using Endgame.Domain.Cascade;
using Endgame.Domain.Platform;
using Endgame.Infrastructure.Cascade;
using Endgame.Infrastructure.Persistence;
using Endgame.Infrastructure.Tenancy;
using Endgame.Infrastructure.Tree;
using Microsoft.EntityFrameworkCore;

namespace Endgame.Infrastructure.Platform;

public sealed record SentEmailView(IReadOnlyList<string> To, string Subject, string Text, string Status, DateTimeOffset CreatedAt);

/// <param name="Preview">True when the call goes to the app's preview instance (the evaluator's, before publishing).</param>
public sealed record WebhookTestRequest(string? Name, string? Header, string? Scheme, string? SecretName, string? Prefix, string? Body, bool? Preview = null);

public sealed record WebhookTestResult(int Status, string? ContentType, string Body, bool Truncated, bool SecretCreated, string SecretName);

/// <summary>
/// What the factory's evaluator needs to show two kinds of requirement working in the running app (ARCH-006,
/// <i>Checking the work</i>): the e-mail the app asked the platform to send, and a declared webhook called the way
/// its device would call it. A webhook is signed here, with the vault's secret, which never leaves the control plane;
/// a secret the app needs and nobody has set is made at the app's level (32 random bytes), so the owner can hand it
/// to the device, and the answer says so.
/// </summary>
public sealed partial class EvaluatorAids(EndgameDbContext db, TenantSession session, CascadeService cascade, AppGateway gateway)
{
    public async Task<IReadOnlyList<SentEmailView>> SentEmailsAsync(ResolvedScope app, int limit, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(app);
        session.UseOrganisation(app.OrganisationId);
        var rows = await db.EmailMessages.AsNoTracking()
            .Where(m => m.OrganisationId == app.OrganisationId && m.AppId == app.AppId)
            .OrderByDescending(m => m.CreatedAt).Take(Math.Clamp(limit, 1, 50)).ToListAsync(cancellationToken);
        return rows.Select(m => new SentEmailView(m.Recipients, m.Subject, m.TextBody.Length > 2000 ? m.TextBody[..2000] : m.TextBody, m.Status, m.CreatedAt)).ToList();
    }

    public async Task<WebhookTestResult> CallWebhookAsync(ResolvedScope app, WebhookTestRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(app);
        ArgumentNullException.ThrowIfNull(request);
        var name = request.Name ?? "";
        var header = request.Header?.Trim() ?? "";
        var secretName = request.SecretName?.Trim() ?? "";
        if (!HeaderName().IsMatch(header) || header.StartsWith("X-Endgame-", StringComparison.OrdinalIgnoreCase) || header.StartsWith("X-Forwarded-", StringComparison.OrdinalIgnoreCase)
            || header.Equals("Authorization", StringComparison.OrdinalIgnoreCase) || header.Equals("Cookie", StringComparison.OrdinalIgnoreCase))
        {
            throw EndgameProblem.Invalid("header is the device's own header name (letters, digits and hyphens), never a platform, forwarding, cookie or authorization header.");
        }

        if (request.Scheme is not ("hmac-sha256" or "shared-token"))
        {
            throw EndgameProblem.Invalid("scheme is hmac-sha256 (the header carries hex(HMAC-SHA256(secret, body)) after the prefix) or shared-token (the header carries the secret).");
        }

        if (!SecretName().IsMatch(secretName))
        {
            throw EndgameProblem.Invalid("secretName is the vault secret the app verifies with, in UPPER_SNAKE_CASE.");
        }

        session.UseOrganisation(app.OrganisationId);
        if (!await db.AppWebhooks.AsNoTracking().AnyAsync(w => w.OrganisationId == app.OrganisationId && w.AppId == app.AppId && w.Name == name, cancellationToken))
        {
            throw EndgameProblem.NotFound($"A webhook called '{name}' declared by this app");
        }

        var created = false;
        var secret = (await cascade.RevealSecretAsync(app, secretName, cancellationToken))?.Value;
        if (secret is null)
        {
            secret = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(32));
            await cascade.SetAsync(app, CascadeKind.Secret, secretName, JsonValue.Create(secret), null, Actor.Agent, cancellationToken);
            created = true;
        }

        var body = request.Body ?? "";
        var value = request.Scheme == "shared-token"
            ? secret
            : (request.Prefix ?? "") + Convert.ToHexStringLower(HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes(body)));
        var answer = await gateway.CallHookAsync(app.AppId!.Value, name, header, value, body, cancellationToken, preview: request.Preview == true);
        return new WebhookTestResult(answer.Status, answer.ContentType, answer.Text, answer.Truncated, created, secretName);
    }

    [GeneratedRegex("^[A-Za-z0-9][A-Za-z0-9-]{0,63}$")]
    private static partial Regex HeaderName();

    [GeneratedRegex("^[A-Z][A-Z0-9_]{0,63}$")]
    private static partial Regex SecretName();
}
