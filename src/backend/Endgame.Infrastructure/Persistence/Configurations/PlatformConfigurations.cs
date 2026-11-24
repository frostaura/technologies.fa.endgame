using Endgame.Domain.Tree;
using Endgame.Infrastructure.Persistence.Records;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Endgame.Infrastructure.Persistence.Configurations;

internal static class AppScopedMapping
{
    /// <summary>
    /// The organisation and app columns of an app's own row: the app is a composite foreign key with
    /// the organisation, so a row can never point into another organisation's tree.
    /// </summary>
    public static void MapApp<T>(this EntityTypeBuilder<T> builder)
        where T : class
    {
        builder.Property<Guid>("OrganisationId").HasColumnName("organisation_id").IsRequired();
        builder.Property<Guid>("AppId").HasColumnName("app_id").IsRequired();
        builder.HasOne<App>().WithMany()
            .HasForeignKey("OrganisationId", "AppId")
            .HasPrincipalKey(nameof(App.OrganisationId), nameof(App.Id))
            .OnDelete(DeleteBehavior.Restrict);
    }
}

internal sealed class AppTokenConfiguration : IEntityTypeConfiguration<AppTokenRecord>
{
    public void Configure(EntityTypeBuilder<AppTokenRecord> builder)
    {
        builder.ToTable("app_tokens");
        builder.HasKey(t => t.Id);
        builder.Property(t => t.Id).HasColumnName("id").ValueGeneratedNever();
        builder.MapApp();
        builder.Property(t => t.Salt).HasColumnName("salt");
        builder.Property(t => t.TokenHash).HasColumnName("token_hash").HasMaxLength(64);
        builder.Property(t => t.CreatedAt).HasColumnName("created_at");
        builder.Property(t => t.ValidUntil).HasColumnName("valid_until");
        builder.HasIndex(t => t.TokenHash).IsUnique();
        builder.HasIndex(t => new { t.OrganisationId, t.AppId, t.CreatedAt });
    }
}

internal sealed class AppEndUserConfiguration : IEntityTypeConfiguration<AppEndUserRecord>
{
    public void Configure(EntityTypeBuilder<AppEndUserRecord> builder)
    {
        builder.ToTable("app_end_users");
        builder.HasKey(u => u.Id);
        builder.HasAlternateKey(u => new { u.OrganisationId, u.Id });
        builder.Property(u => u.Id).HasColumnName("id").ValueGeneratedNever();
        builder.MapApp();
        builder.Property(u => u.Email).HasColumnName("email").HasMaxLength(254);
        builder.Property(u => u.DisplayName).HasColumnName("display_name").HasMaxLength(200);
        builder.Property(u => u.CreatedAt).HasColumnName("created_at");
        builder.Property(u => u.LastSignInAt).HasColumnName("last_sign_in_at");
        builder.HasIndex(u => new { u.OrganisationId, u.AppId, u.Email }).IsUnique();
    }
}

internal sealed class AppEndUserPasskeyConfiguration : IEntityTypeConfiguration<AppEndUserPasskeyRecord>
{
    public void Configure(EntityTypeBuilder<AppEndUserPasskeyRecord> builder)
    {
        builder.ToTable("app_end_user_passkeys");
        builder.HasKey(p => new { p.OrganisationId, p.CredentialId });
        builder.Property(p => p.CredentialId).HasColumnName("credential_id").HasMaxLength(1024);
        builder.MapApp();
        builder.Property(p => p.EndUserId).HasColumnName("end_user_id");
        builder.Property(p => p.PublicKey).HasColumnName("public_key");
        builder.Property(p => p.Name).HasColumnName("name").HasMaxLength(200);
        builder.Property(p => p.CreatedAt).HasColumnName("created_at");
        builder.Property(p => p.SignCount).HasColumnName("sign_count");
        builder.Property(p => p.Transports).HasColumnName("transports");
        builder.Property(p => p.IsUserVerified).HasColumnName("is_user_verified");
        builder.Property(p => p.IsBackupEligible).HasColumnName("is_backup_eligible");
        builder.Property(p => p.IsBackedUp).HasColumnName("is_backed_up");
        builder.Property(p => p.AttestationObject).HasColumnName("attestation_object");
        builder.Property(p => p.ClientDataJson).HasColumnName("client_data_json");
        builder.HasOne<AppEndUserRecord>().WithMany()
            .HasForeignKey(p => new { p.OrganisationId, p.EndUserId })
            .HasPrincipalKey(u => new { u.OrganisationId, u.Id })
            .OnDelete(DeleteBehavior.Cascade);
        builder.HasIndex(p => new { p.OrganisationId, p.EndUserId });
    }
}

internal sealed class AppSessionConfiguration : IEntityTypeConfiguration<AppSessionRecord>
{
    public void Configure(EntityTypeBuilder<AppSessionRecord> builder)
    {
        builder.ToTable("app_sessions");
        builder.HasKey(s => s.Id);
        builder.Property(s => s.Id).HasColumnName("id").ValueGeneratedNever();
        builder.MapApp();
        builder.Property(s => s.EndUserId).HasColumnName("end_user_id");
        builder.Property(s => s.TokenHash).HasColumnName("token_hash").HasMaxLength(64);
        builder.Property(s => s.CreatedAt).HasColumnName("created_at");
        builder.Property(s => s.ExpiresAt).HasColumnName("expires_at");
        builder.Property(s => s.RevokedAt).HasColumnName("revoked_at");
        builder.HasOne<AppEndUserRecord>().WithMany()
            .HasForeignKey(s => new { s.OrganisationId, s.EndUserId })
            .HasPrincipalKey(u => new { u.OrganisationId, u.Id })
            .OnDelete(DeleteBehavior.Cascade);
        builder.HasIndex(s => s.TokenHash).IsUnique();
    }
}

internal sealed class AppShareConfiguration : IEntityTypeConfiguration<AppShareRecord>
{
    public void Configure(EntityTypeBuilder<AppShareRecord> builder)
    {
        builder.ToTable("app_shares");
        builder.HasKey(s => s.Id);
        builder.Property(s => s.Id).HasColumnName("id").ValueGeneratedNever();
        builder.MapApp();
        builder.Property(s => s.Email).HasColumnName("email").HasMaxLength(254);
        builder.Property(s => s.InvitationCodeHash).HasColumnName("invitation_code_hash").HasMaxLength(64);
        builder.Property(s => s.InvitationExpiresAt).HasColumnName("invitation_expires_at");
        builder.Property(s => s.InvitedBy).HasColumnName("invited_by");
        builder.Property(s => s.InvitedAt).HasColumnName("invited_at");
        builder.HasIndex(s => new { s.OrganisationId, s.AppId, s.Email }).IsUnique();
    }
}

internal sealed class AppScheduleConfiguration : IEntityTypeConfiguration<AppScheduleRecord>
{
    public void Configure(EntityTypeBuilder<AppScheduleRecord> builder)
    {
        builder.ToTable("app_schedules");
        builder.HasKey(s => s.Id);
        builder.Property(s => s.Id).HasColumnName("id").ValueGeneratedNever();
        builder.MapApp();
        builder.Property(s => s.Name).HasColumnName("name").HasMaxLength(40);
        builder.Property(s => s.Cron).HasColumnName("cron").HasMaxLength(200);
        builder.Property(s => s.TimeZone).HasColumnName("time_zone").HasMaxLength(64);
        builder.Property(s => s.Path).HasColumnName("path").HasMaxLength(200);
        builder.Property(s => s.NextRunAt).HasColumnName("next_run_at");
        builder.Property(s => s.LeaseHolder).HasColumnName("lease_holder").HasMaxLength(200);
        builder.Property(s => s.LeaseExpiresAt).HasColumnName("lease_expires_at");
        builder.Property(s => s.LastRunAt).HasColumnName("last_run_at");
        builder.Property(s => s.LastScheduledFor).HasColumnName("last_scheduled_for");
        builder.Property(s => s.LastStatus).HasColumnName("last_status");
        builder.Property(s => s.LastError).HasColumnName("last_error").HasMaxLength(500);
        builder.Property(s => s.UpdatedAt).HasColumnName("updated_at");
        builder.HasIndex(s => new { s.OrganisationId, s.AppId, s.Name }).IsUnique();
        builder.HasIndex(s => s.NextRunAt);
    }
}

internal sealed class AppWebhookConfiguration : IEntityTypeConfiguration<AppWebhookRecord>
{
    public void Configure(EntityTypeBuilder<AppWebhookRecord> builder)
    {
        builder.ToTable("app_webhooks");
        builder.HasKey(w => w.Id);
        builder.Property(w => w.Id).HasColumnName("id").ValueGeneratedNever();
        builder.MapApp();
        builder.Property(w => w.Name).HasColumnName("name").HasMaxLength(40);
        builder.Property(w => w.Path).HasColumnName("path").HasMaxLength(200);
        builder.Property(w => w.UpdatedAt).HasColumnName("updated_at");
        builder.HasIndex(w => new { w.OrganisationId, w.AppId, w.Name }).IsUnique();
    }
}

internal sealed class EmailMessageConfiguration : IEntityTypeConfiguration<EmailMessageRecord>
{
    public static readonly IReadOnlyList<string> Statuses = ["queued", "sending", "sent", "failed"];

    public void Configure(EntityTypeBuilder<EmailMessageRecord> builder)
    {
        builder.ToTable("email_messages");
        builder.HasKey(e => e.Id);
        builder.Property(e => e.Id).HasColumnName("id").ValueGeneratedNever();
        builder.MapApp();
        builder.Property(e => e.Recipients).HasColumnName("recipients");
        builder.Property(e => e.Subject).HasColumnName("subject").HasMaxLength(300);
        builder.Property(e => e.TextBody).HasColumnName("text_body");
        builder.Property(e => e.HtmlBody).HasColumnName("html_body");
        builder.Property(e => e.ReplyTo).HasColumnName("reply_to").HasMaxLength(254);
        builder.Property(e => e.Status).HasColumnName("status").HasMaxLength(20);
        builder.Property(e => e.Attempts).HasColumnName("attempts");
        builder.Property(e => e.NextAttemptAt).HasColumnName("next_attempt_at");
        builder.Property(e => e.LeaseUntil).HasColumnName("lease_until");
        builder.Property(e => e.LastError).HasColumnName("last_error").HasMaxLength(500);
        builder.Property(e => e.CreatedAt).HasColumnName("created_at");
        builder.Property(e => e.SentAt).HasColumnName("sent_at");
        builder.Status("email_messages", "status", Statuses);
        builder.HasIndex(e => new { e.Status, e.NextAttemptAt });
    }
}

internal sealed class TelemetryEventConfiguration : IEntityTypeConfiguration<TelemetryEventRecord>
{
    public void Configure(EntityTypeBuilder<TelemetryEventRecord> builder)
    {
        builder.ToTable("telemetry_events");
        builder.HasKey(e => e.Id);
        builder.Property(e => e.Id).HasColumnName("id").ValueGeneratedNever();
        builder.MapApp();
        builder.Property(e => e.Name).HasColumnName("name").HasMaxLength(100);
        builder.Property(e => e.At).HasColumnName("at");
        builder.Property(e => e.UserId).HasColumnName("user_id").HasMaxLength(100);
        builder.Property(e => e.PropertiesJson).HasColumnName("properties").HasColumnType("jsonb");
        builder.Property(e => e.ReceivedAt).HasColumnName("received_at");
        builder.HasIndex(e => new { e.OrganisationId, e.AppId, e.At });
        builder.HasIndex(e => e.ReceivedAt);
    }
}

internal sealed class TelemetrySpanConfiguration : IEntityTypeConfiguration<TelemetrySpanRecord>
{
    public void Configure(EntityTypeBuilder<TelemetrySpanRecord> builder)
    {
        builder.ToTable("telemetry_spans");
        builder.HasKey(s => s.Id);
        builder.Property(s => s.Id).HasColumnName("id").ValueGeneratedNever();
        builder.MapApp();
        builder.Property(s => s.TraceId).HasColumnName("trace_id").HasMaxLength(32);
        builder.Property(s => s.SpanId).HasColumnName("span_id").HasMaxLength(16);
        builder.Property(s => s.ParentSpanId).HasColumnName("parent_span_id").HasMaxLength(16);
        builder.Property(s => s.Name).HasColumnName("name").HasMaxLength(300);
        builder.Property(s => s.Kind).HasColumnName("kind");
        builder.Property(s => s.StartAt).HasColumnName("start_at");
        builder.Property(s => s.DurationMs).HasColumnName("duration_ms");
        builder.Property(s => s.StatusCode).HasColumnName("status_code");
        builder.Property(s => s.HttpMethod).HasColumnName("http_method").HasMaxLength(20);
        builder.Property(s => s.HttpRoute).HasColumnName("http_route").HasMaxLength(300);
        builder.Property(s => s.UrlPath).HasColumnName("url_path").HasMaxLength(500);
        builder.Property(s => s.HttpStatus).HasColumnName("http_status");
        builder.Property(s => s.ReceivedAt).HasColumnName("received_at");
        builder.HasIndex(s => new { s.OrganisationId, s.AppId, s.Kind, s.StartAt });
        builder.HasIndex(s => s.ReceivedAt);
    }
}

internal sealed class TelemetryMetricConfiguration : IEntityTypeConfiguration<TelemetryMetricRecord>
{
    public void Configure(EntityTypeBuilder<TelemetryMetricRecord> builder)
    {
        builder.ToTable("telemetry_metrics");
        builder.HasKey(m => m.Id);
        builder.Property(m => m.Id).HasColumnName("id").ValueGeneratedNever();
        builder.MapApp();
        builder.Property(m => m.Name).HasColumnName("name").HasMaxLength(200);
        builder.Property(m => m.Unit).HasColumnName("unit").HasMaxLength(50);
        builder.Property(m => m.Type).HasColumnName("type").HasMaxLength(20);
        builder.Property(m => m.At).HasColumnName("at");
        builder.Property(m => m.Value).HasColumnName("value");
        builder.Property(m => m.Count).HasColumnName("count");
        builder.Property(m => m.Sum).HasColumnName("sum");
        builder.Property(m => m.ReceivedAt).HasColumnName("received_at");
        builder.HasIndex(m => new { m.OrganisationId, m.AppId, m.Name, m.At });
        builder.HasIndex(m => m.ReceivedAt);
    }
}

internal sealed class TelemetryLogConfiguration : IEntityTypeConfiguration<TelemetryLogRecord>
{
    public void Configure(EntityTypeBuilder<TelemetryLogRecord> builder)
    {
        builder.ToTable("telemetry_logs");
        builder.HasKey(l => l.Id);
        builder.Property(l => l.Id).HasColumnName("id").ValueGeneratedNever();
        builder.MapApp();
        builder.Property(l => l.At).HasColumnName("at");
        builder.Property(l => l.SeverityNumber).HasColumnName("severity_number");
        builder.Property(l => l.SeverityText).HasColumnName("severity_text").HasMaxLength(20);
        builder.Property(l => l.Body).HasColumnName("body");
        builder.Property(l => l.Category).HasColumnName("category").HasMaxLength(300);
        builder.Property(l => l.TraceId).HasColumnName("trace_id").HasMaxLength(32);
        builder.Property(l => l.SpanId).HasColumnName("span_id").HasMaxLength(16);
        builder.Property(l => l.ReceivedAt).HasColumnName("received_at");
        builder.HasIndex(l => new { l.OrganisationId, l.AppId, l.At });
        builder.HasIndex(l => l.ReceivedAt);
    }
}

internal sealed class HostingSampleConfiguration : IEntityTypeConfiguration<HostingSampleRecord>
{
    public void Configure(EntityTypeBuilder<HostingSampleRecord> builder)
    {
        builder.ToTable("hosting_samples");
        builder.HasKey(h => h.Id);
        builder.Property(h => h.Id).HasColumnName("id").ValueGeneratedNever();
        builder.MapApp();
        builder.Property(h => h.SampleId).HasColumnName("sample_id").HasMaxLength(200);
        builder.Property(h => h.PeriodStart).HasColumnName("period_start");
        builder.Property(h => h.PeriodEnd).HasColumnName("period_end");
        builder.Property(h => h.AwakeSeconds).HasColumnName("awake_seconds");
        builder.Property(h => h.MemoryBytes).HasColumnName("memory_bytes");
        builder.Property(h => h.StorageBytes).HasColumnName("storage_bytes");
        builder.Property(h => h.Requests).HasColumnName("requests");
        builder.Property(h => h.CostUsd).HasColumnName("cost_usd").HasPrecision(20, 10);
        builder.Property(h => h.Credits).HasColumnName("credits").HasPrecision(20, 6);
        builder.Property(h => h.CreditEntryId).HasColumnName("credit_entry_id");
        builder.Property(h => h.ReceivedAt).HasColumnName("received_at");
        builder.ToTable(t => t.HasCheckConstraint("ck_hosting_samples_period",
            "period_end > period_start AND awake_seconds >= 0 AND memory_bytes >= 0 AND storage_bytes >= 0 AND requests >= 0"));
        builder.HasOne<CreditEntryRecord>().WithMany()
            .HasForeignKey(h => new { h.OrganisationId, h.CreditEntryId })
            .HasPrincipalKey(e => new { e.OrganisationId, e.Id })
            .OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(h => new { h.OrganisationId, h.SampleId }).IsUnique();
        builder.HasIndex(h => new { h.OrganisationId, h.AppId, h.PeriodEnd });
    }
}
