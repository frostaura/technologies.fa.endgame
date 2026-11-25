using Endgame.Domain.Access;
using Endgame.Domain.Platform;
using Endgame.Domain.Tree;
using Endgame.Infrastructure.Identity;
using Endgame.Infrastructure.Persistence.Records;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Endgame.Infrastructure.Persistence.Configurations;

internal sealed class AccessTokenConfiguration : IEntityTypeConfiguration<AccessTokenRecord>
{
    public void Configure(EntityTypeBuilder<AccessTokenRecord> builder)
    {
        builder.ToTable("access_tokens");
        builder.HasKey(t => t.Id);
        builder.Property(t => t.Id).HasColumnName("id").ValueGeneratedNever();
        builder.Property(t => t.OrganisationId).HasColumnName("organisation_id");
        builder.Property(t => t.UserId).HasColumnName("user_id");
        builder.Property(t => t.Name).HasColumnName("name").HasMaxLength(100);
        builder.Property(t => t.Role).HasColumnName("role").HasMaxLength(20);
        builder.Property(t => t.Prefix).HasColumnName("prefix").HasMaxLength(16);
        builder.Property(t => t.TokenHash).HasColumnName("token_hash").HasMaxLength(64);
        builder.Property(t => t.CreatedAt).HasColumnName("created_at");
        builder.Property(t => t.ExpiresAt).HasColumnName("expires_at");
        builder.Property(t => t.LastUsedAt).HasColumnName("last_used_at");
        builder.Property(t => t.RevokedAt).HasColumnName("revoked_at");
        // A token never carries Owner: whatever only the Owner may do stays with the person.
        builder.Status("access_tokens", "role", MemberRoles.All.Where(r => r != "owner"));
        builder.HasOne<Organisation>().WithMany().HasForeignKey(t => t.OrganisationId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<EndgameUser>().WithMany().HasForeignKey(t => t.UserId).OnDelete(DeleteBehavior.Cascade);
        builder.HasIndex(t => t.TokenHash).IsUnique();
        builder.HasIndex(t => new { t.OrganisationId, t.UserId });
    }
}

internal sealed class NotificationConfiguration : IEntityTypeConfiguration<NotificationRecord>
{
    public void Configure(EntityTypeBuilder<NotificationRecord> builder)
    {
        builder.ToTable("notifications");
        builder.HasKey(n => n.Id);
        builder.HasAlternateKey(n => new { n.OrganisationId, n.Id });
        builder.Property(n => n.Id).HasColumnName("id").ValueGeneratedNever();
        builder.MapScope("notifications");
        builder.Property(n => n.Kind).HasColumnName("kind").HasMaxLength(40);
        builder.Property(n => n.Severity).HasColumnName("severity").HasMaxLength(10);
        builder.Property(n => n.Title).HasColumnName("title").HasMaxLength(300);
        builder.Property(n => n.Detail).HasColumnName("detail").HasMaxLength(2000);
        builder.Property(n => n.SubjectJson).HasColumnName("subject").HasColumnType("jsonb");
        builder.Property(n => n.DedupeKey).HasColumnName("dedupe_key").HasMaxLength(200);
        builder.Property(n => n.CreatedAt).HasColumnName("created_at");
        builder.Property(n => n.EmailedAt).HasColumnName("emailed_at");
        builder.Status("notifications", "kind", NotificationKinds.All);
        builder.Status("notifications", "severity", NotificationKinds.Severities);
        builder.HasIndex(n => new { n.OrganisationId, n.DedupeKey }).IsUnique();
        builder.HasIndex(n => new { n.OrganisationId, n.CreatedAt });
    }
}

internal sealed class NotificationReadConfiguration : IEntityTypeConfiguration<NotificationReadRecord>
{
    public void Configure(EntityTypeBuilder<NotificationReadRecord> builder)
    {
        builder.ToTable("notification_reads");
        builder.HasKey(r => new { r.OrganisationId, r.NotificationId, r.UserId });
        builder.Property(r => r.OrganisationId).HasColumnName("organisation_id");
        builder.Property(r => r.NotificationId).HasColumnName("notification_id");
        builder.Property(r => r.UserId).HasColumnName("user_id");
        builder.Property(r => r.ReadAt).HasColumnName("read_at");
        builder.HasOne<NotificationRecord>().WithMany()
            .HasForeignKey(r => new { r.OrganisationId, r.NotificationId })
            .HasPrincipalKey(n => new { n.OrganisationId, n.Id })
            .OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<EndgameUser>().WithMany().HasForeignKey(r => r.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}

internal sealed class IdeaSuggestionConfiguration : IEntityTypeConfiguration<IdeaSuggestionRecord>
{
    public void Configure(EntityTypeBuilder<IdeaSuggestionRecord> builder)
    {
        builder.ToTable("idea_suggestions");
        builder.HasKey(s => s.Id);
        builder.Property(s => s.Id).HasColumnName("id").ValueGeneratedNever();
        builder.MapScope("idea_suggestions");
        builder.Property(s => s.RunId).HasColumnName("run_id");
        builder.Property(s => s.Title).HasColumnName("title").HasMaxLength(200);
        builder.Property(s => s.Idea).HasColumnName("idea").HasMaxLength(4000);
        builder.Property(s => s.Gap).HasColumnName("gap").HasMaxLength(2000);
        builder.Property(s => s.WhyUs).HasColumnName("why_us").HasMaxLength(2000);
        builder.Property(s => s.Reuses).HasColumnName("reuses").HasDefaultValueSql("'{}'::text[]");
        builder.Property(s => s.Status).HasColumnName("status").HasMaxLength(20);
        builder.Property(s => s.IdeaId).HasColumnName("idea_id");
        builder.Property(s => s.CreatedAt).HasColumnName("created_at");
        builder.Property(s => s.DecidedAt).HasColumnName("decided_at");
        builder.Property(s => s.DecidedBy).HasColumnName("decided_by");
        builder.Status("idea_suggestions", "status", SuggestionStatuses.All);
        builder.ToTable(t => t.HasCheckConstraint("ck_idea_suggestions_taken", "(status = 'taken') = (idea_id IS NOT NULL)"));
        builder.HasOne<RunRecord>().WithMany()
            .HasForeignKey(s => new { s.OrganisationId, s.RunId })
            .HasPrincipalKey(r => new { r.OrganisationId, r.Id })
            .OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<IdeaRecord>().WithMany()
            .HasForeignKey(s => new { s.OrganisationId, s.IdeaId })
            .HasPrincipalKey(i => new { i.OrganisationId, i.Id })
            .OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(s => new { s.OrganisationId, s.CreatedAt });
    }
}

internal sealed class SavedQuestionConfiguration : IEntityTypeConfiguration<SavedQuestionRecord>
{
    public void Configure(EntityTypeBuilder<SavedQuestionRecord> builder)
    {
        builder.ToTable("app_dashboard_questions");
        builder.HasKey(q => q.Id);
        builder.Property(q => q.Id).HasColumnName("id").ValueGeneratedNever();
        builder.MapApp();
        builder.Property(q => q.Question).HasColumnName("question").HasMaxLength(500);
        builder.Property(q => q.Sql).HasColumnName("sql").HasMaxLength(4000);
        builder.Property(q => q.ChartJson).HasColumnName("chart").HasColumnType("jsonb");
        builder.Property(q => q.Answer).HasColumnName("answer").HasMaxLength(2000);
        builder.Property(q => q.CreatedBy).HasColumnName("created_by");
        builder.Property(q => q.CreatedAt).HasColumnName("created_at");
        builder.HasIndex(q => new { q.OrganisationId, q.AppId });
    }
}

internal sealed class TopUpRequestConfiguration : IEntityTypeConfiguration<TopUpRequestRecord>
{
    public void Configure(EntityTypeBuilder<TopUpRequestRecord> builder)
    {
        builder.ToTable("top_up_requests");
        builder.HasKey(r => r.Id);
        builder.Property(r => r.Id).HasColumnName("id").ValueGeneratedNever();
        builder.Property(r => r.OrganisationId).HasColumnName("organisation_id");
        builder.Property(r => r.Credits).HasColumnName("credits").HasPrecision(20, 6);
        builder.Property(r => r.Note).HasColumnName("note").HasMaxLength(500);
        builder.Property(r => r.Status).HasColumnName("status").HasMaxLength(20);
        builder.Property(r => r.RequestedBy).HasColumnName("requested_by");
        builder.Property(r => r.RequestedAt).HasColumnName("requested_at");
        builder.Property(r => r.ClosedBy).HasColumnName("closed_by");
        builder.Property(r => r.ClosedAt).HasColumnName("closed_at");
        builder.Property(r => r.CloseNote).HasColumnName("close_note").HasMaxLength(500);
        builder.Property(r => r.TopUpEntryId).HasColumnName("top_up_entry_id");
        builder.Status("top_up_requests", "status", TopUpRequestStatuses.All);
        builder.ToTable(t =>
        {
            t.HasCheckConstraint("ck_top_up_requests_credits", "credits > 0");
            t.HasCheckConstraint("ck_top_up_requests_closed", "(status = 'open') = (closed_at IS NULL)");
        });
        builder.HasOne<Organisation>().WithMany().HasForeignKey(r => r.OrganisationId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(r => new { r.OrganisationId, r.Status });
    }
}

internal sealed class PlatformSettingConfiguration : IEntityTypeConfiguration<PlatformSettingRecord>
{
    public void Configure(EntityTypeBuilder<PlatformSettingRecord> builder)
    {
        builder.ToTable("platform_settings");
        builder.HasKey(s => s.Key);
        builder.Property(s => s.Key).HasColumnName("key").HasMaxLength(60);
        builder.Property(s => s.ValueJson).HasColumnName("value").HasColumnType("jsonb");
        builder.Property(s => s.UpdatedAt).HasColumnName("updated_at");
        builder.Property(s => s.UpdatedBy).HasColumnName("updated_by");
    }
}

internal sealed class PlatformSettingChangeConfiguration : IEntityTypeConfiguration<PlatformSettingChangeRecord>
{
    public void Configure(EntityTypeBuilder<PlatformSettingChangeRecord> builder)
    {
        builder.ToTable("platform_setting_changes");
        builder.HasKey(c => c.Id);
        builder.Property(c => c.Id).HasColumnName("id").ValueGeneratedNever();
        builder.Property(c => c.Key).HasColumnName("key").HasMaxLength(60);
        builder.Property(c => c.BeforeJson).HasColumnName("before").HasColumnType("jsonb");
        builder.Property(c => c.AfterJson).HasColumnName("after").HasColumnType("jsonb");
        builder.Property(c => c.ChangedBy).HasColumnName("changed_by");
        builder.Property(c => c.ChangedAt).HasColumnName("changed_at");
        builder.HasIndex(c => new { c.Key, c.ChangedAt });
    }
}

internal sealed class PlatformCostConfiguration : IEntityTypeConfiguration<PlatformCostRecord>
{
    public void Configure(EntityTypeBuilder<PlatformCostRecord> builder)
    {
        builder.ToTable("platform_costs");
        builder.HasKey(c => c.Id);
        builder.Property(c => c.Id).HasColumnName("id").ValueGeneratedNever();
        builder.Property(c => c.Purpose).HasColumnName("purpose").HasMaxLength(60);
        builder.Property(c => c.Model).HasColumnName("model").HasMaxLength(200);
        builder.Property(c => c.GenerationId).HasColumnName("generation_id").HasMaxLength(200);
        builder.Property(c => c.CostUsd).HasColumnName("cost_usd").HasPrecision(18, 8);
        builder.Property(c => c.DetailJson).HasColumnName("detail").HasColumnType("jsonb");
        builder.Property(c => c.By).HasColumnName("by");
        builder.Property(c => c.At).HasColumnName("at");
        builder.HasIndex(c => new { c.Purpose, c.At });
    }
}
