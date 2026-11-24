using System.Security.Cryptography;
using Endgame.Application.Common;
using Endgame.Domain;
using Endgame.Domain.Platform;
using Endgame.Infrastructure.Platform;
using Endgame.Infrastructure.Vault;
using Endgame.Tests.Fixtures;
using Microsoft.Extensions.Configuration;

namespace Endgame.Tests.ControlPlane;

/// <summary>The pure pieces under the platform API: cron, the OTLP reader and the vault's envelope.</summary>
public sealed class PlatformUnitTests
{
    private static readonly DateTimeOffset Start = new(2026, 11, 24, 10, 30, 0, TimeSpan.Zero);

    [Theory]
    [InlineData("* * * * *", "2026-11-24T10:31:00Z")]
    [InlineData("0 3 * * *", "2026-11-25T03:00:00Z")]
    [InlineData("*/15 * * * *", "2026-11-24T10:45:00Z")]
    [InlineData("0 9-17/4 * * mon-fri", "2026-11-24T13:00:00Z")]
    [InlineData("0 0 1 jan *", "2027-01-01T00:00:00Z")]
    [InlineData("0 12 * * 7", "2026-11-29T12:00:00Z")]
    [InlineData("0 0 13 * fri", "2026-11-27T00:00:00Z")] // day of month OR day of week
    [InlineData("0 0 29 2 *", "2028-02-29T00:00:00Z")]
    public void Cron_finds_the_next_run_in_utc(string expression, string expected) =>
        Assert.Equal(DateTimeOffset.Parse(expected, System.Globalization.CultureInfo.InvariantCulture), CronSchedule.Parse(expression).NextAfter(Start, TimeZoneInfo.Utc));

    [Theory]
    [InlineData("")]
    [InlineData("* * * *")]
    [InlineData("60 * * * *")]
    [InlineData("* 24 * * *")]
    [InlineData("5-1 * * * *")]
    [InlineData("*/0 * * * *")]
    [InlineData("0 0 30 2 *")]
    [InlineData("0 0 * foo *")]
    public void Bad_cron_is_refused(string expression) => Assert.Throws<DomainException>(() => CronSchedule.Parse(expression));

    [Fact]
    public void Cron_reads_its_time_zone_and_survives_daylight_saving()
    {
        var london = CronSchedule.Zone("Europe/London");
        // 01:30 local on 2026-03-29 does not exist (clocks go 01:00 → 02:00): the next 01:30 is the day after.
        Assert.Equal(new DateTimeOffset(2026, 3, 30, 0, 30, 0, TimeSpan.Zero),
            CronSchedule.Parse("30 1 * * *").NextAfter(new DateTimeOffset(2026, 3, 28, 12, 0, 0, TimeSpan.Zero), london));
        // 01:30 local on 2026-10-25 happens twice: it runs once, at the first (BST, 00:30 UTC).
        var first = CronSchedule.Parse("30 1 * * *").NextAfter(new DateTimeOffset(2026, 10, 24, 12, 0, 0, TimeSpan.Zero), london)!.Value;
        Assert.Equal(new DateTimeOffset(2026, 10, 25, 0, 30, 0, TimeSpan.Zero), first);
        Assert.Equal(new DateTimeOffset(2026, 10, 26, 1, 30, 0, TimeSpan.Zero), CronSchedule.Parse("30 1 * * *").NextAfter(first, london));
        Assert.Throws<DomainException>(() => CronSchedule.Zone("Not/AZone"));
    }

    [Fact]
    public void Otlp_protobuf_traces_metrics_and_logs_are_read_field_for_field()
    {
        var at = new DateTimeOffset(2026, 11, 24, 12, 0, 0, TimeSpan.Zero);
        var span = Assert.Single(OtlpDecoder.Traces(OtlpWriter.Traces("app", new OtlpWriter.Span("GET api/notes", 2, at, 42.5, "GET", "/api/notes", 503, "api/notes")), json: false));
        Assert.Equal("GET api/notes", span.Name);
        Assert.Equal(2, span.Kind);
        Assert.Equal(at, span.Start);
        Assert.Equal(42.5, span.DurationMs, 3);
        Assert.Equal(("GET", "api/notes", "/api/notes", 503, 2), (span.HttpMethod, span.HttpRoute, span.UrlPath, span.HttpStatus, span.StatusCode));
        Assert.Equal(32, span.TraceId.Length);
        Assert.Equal(16, span.SpanId.Length);

        var point = Assert.Single(OtlpDecoder.Metrics(OtlpWriter.Metrics("app", "http.server.request.duration", 12.5, at), json: false));
        Assert.Equal(("http.server.request.duration", "ms", "gauge", at, 12.5), (point.Name, point.Unit, point.Type, point.At, point.Value!.Value));

        var log = Assert.Single(OtlpDecoder.Logs(OtlpWriter.Logs("app", "Booked court 2", 9, at), json: false));
        Assert.Equal(("Booked court 2", 9, "Information", "App.Notes", at), (log.Body, log.SeverityNumber, log.SeverityText, log.Category, log.At));

        Assert.Throws<FormatException>(() => OtlpDecoder.Traces(new byte[] { 0x0a, 0x05, 0x01 }, json: false));
        Assert.Empty(OtlpDecoder.Traces([], json: false));
    }

    private static EnvelopeVault Vault(string? key) =>
        new(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { [EnvelopeVault.MasterKeyVariable] = key }).Build());

    [Fact]
    public void The_vault_seals_each_value_under_its_own_data_key_bound_to_its_row()
    {
        var vault = Vault(ControlPlaneApp.VaultKey);
        var a = vault.Seal("hunter2", "secret:org:node:STRIPE_KEY");
        var b = vault.Seal("hunter2", "secret:org:node:STRIPE_KEY");
        Assert.NotEqual(a, b); // fresh data key and nonces every time
        Assert.DoesNotContain("hunter2", a, StringComparison.Ordinal);
        Assert.Equal("hunter2", vault.Open(a, "secret:org:node:STRIPE_KEY"));
        // Copied onto another row, it does not open.
        Assert.ThrowsAny<CryptographicException>(() => vault.Open(a, "secret:other-org:node:STRIPE_KEY"));
        // Under another master key it is refused with a reason, not garbage.
        var other = Vault(Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)));
        Assert.Equal("vault_key_mismatch", Assert.Throws<EndgameProblem>(() => other.Open(a, "secret:org:node:STRIPE_KEY")).Code);
        // With no master key nothing is sealed at all.
        var none = Vault(null);
        Assert.False(none.IsConfigured);
        Assert.Equal("vault_unconfigured", Assert.Throws<EndgameProblem>(() => none.Seal("x", "y")).Code);
        Assert.Throws<InvalidOperationException>(() => Vault("too-short"));
        Assert.Equal("hunter2", Vault(Convert.ToHexString(Convert.FromBase64String(ControlPlaneApp.VaultKey))).Open(a, "secret:org:node:STRIPE_KEY"));
    }

    [Fact]
    public void Names_the_platform_takes_from_apps_are_checked()
    {
        Assert.Equal("nightly-digest", PlatformNames.RequireSlug("Schedule", "nightly-digest"));
        Assert.Throws<DomainException>(() => PlatformNames.RequireSlug("Schedule", "Nightly"));
        Assert.Equal("note.created", PlatformNames.RequireEventName("note.created"));
        Assert.Throws<DomainException>(() => PlatformNames.RequireEventName("note created"));
        Assert.True(Endgame.Domain.Cascade.SecretNames.IsValid("STRIPE_API_KEY"));
        Assert.False(Endgame.Domain.Cascade.SecretNames.IsValid("stripe_key"));
        Assert.Equal("public", AppAccess.Require("public"));
        Assert.Throws<DomainException>(() => AppAccess.Require("everyone"));
        Assert.True(Actor.Operator.IsHuman());
        Assert.False(Actor.Agent.IsHuman());
    }
}
