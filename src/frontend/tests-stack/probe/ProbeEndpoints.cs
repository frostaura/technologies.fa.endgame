using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;

namespace App.Probe;

/// <summary>A secret as the app read it through the platform: its name and a hash of its value, never the value.</summary>
public sealed record SecretProbe(string Name, string Sha256);

/// <summary>An e-mail the stack's acceptance test asks the app to send.</summary>
public sealed record EmailProbe(string To, string Subject);

/// <summary>The platform's id for a queued e-mail.</summary>
public sealed record EmailQueued(string Id);

/// <summary>
/// What the merged stack's acceptance test adds to the template — through a Dock workspace, the way
/// an agent would — to prove the platform end to end from inside a real app: a secret read through
/// the cascade, an e-mail sent, a schedule called back, a webhook let through to a private app.
/// </summary>
public static class ProbeEndpoints
{
    private static readonly ConcurrentQueue<DateTimeOffset> ScheduleRuns = new();

    public static void MapProbe(this WebApplication app, RouteGroupBuilder api)
    {
        app.MapSchedule("probe-minute", "* * * * *", run =>
        {
            ScheduleRuns.Enqueue(run.ScheduledFor);
            return Task.CompletedTask;
        });
        app.MapWebhook("probe-hook", WebhookVerification.SharedToken("X-Probe-Token", "PROBE_HOOK_TOKEN"),
            request => Task.FromResult(Results.Ok(new { received = request.ReadText() })));

        var probe = api.MapGroup("probe").WithTags("Probe");
        probe.MapGet("secrets/{name}", async (string name, IEndgameSecrets secrets, CancellationToken ct) =>
                new SecretProbe(name, Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(await secrets.GetAsync(name, ct))))))
            .WithName("probeSecret")
            .WithSummary("Read a secret")
            .WithDescription("Reads the named secret through the platform's vault and answers its name and the SHA-256 of its value, never the value itself.");
        probe.MapPost("email", async (EmailProbe body, IEndgameEmail email, CancellationToken ct) =>
                new EmailQueued(await email.SendAsync(new EmailMessage([body.To], body.Subject, "Sent from inside an Endgame app by the stack's acceptance test."), ct)))
            .WithName("probeEmail")
            .WithSummary("Send an e-mail")
            .WithDescription("Queues a plain-text e-mail through the platform to one address with the given subject, and answers the platform's id for it.");
        probe.MapGet("schedule-runs", () => ScheduleRuns.ToArray())
            .WithName("probeScheduleRuns")
            .WithSummary("List schedule runs")
            .WithDescription("Every time the platform has called the probe-minute schedule since the app started, as the times the runs were scheduled for.");
    }
}
