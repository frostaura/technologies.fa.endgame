using Endgame.Domain.Tree;
using Endgame.Infrastructure.Identity;
using Endgame.Infrastructure.Persistence.Records;
using Endgame.Infrastructure.Tenancy;
using Microsoft.AspNetCore.DataProtection.EntityFrameworkCore;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace Endgame.Infrastructure.Persistence;

/// <summary>
/// The platform's own database: the cascade tree and everything that hangs off it, the people who
/// sign in (ASP.NET Core Identity, passkeys only), and the data-protection key ring that keeps their
/// cookies valid across restarts.
/// </summary>
/// <remarks>
/// Identity maps the passkey table only when the application's <c>IdentityOptions</c> ask for schema
/// version 3, which it reads from the context's application service provider — see
/// <see cref="IdentityStoreOptions"/>.
/// </remarks>
public sealed class EndgameDbContext : IdentityUserContext<EndgameUser, Guid>, IDataProtectionKeyContext
{
    /// <summary>For migrations and design time: no tenant session, connections run as the connecting role.</summary>
    public EndgameDbContext(DbContextOptions<EndgameDbContext> options)
        : base(options)
    {
    }

    /// <summary>For the running platform: raw commands apply the tenant session as EF's own do.</summary>
    public EndgameDbContext(DbContextOptions<EndgameDbContext> options, TenantSession tenant)
        : base(options)
    {
        Tenant = tenant;
    }

    internal TenantSession? Tenant { get; }

    public DbSet<Organisation> Organisations => Set<Organisation>();

    public DbSet<Division> Divisions => Set<Division>();

    public DbSet<Project> Projects => Set<Project>();

    public DbSet<App> Apps => Set<App>();

    public DbSet<MembershipRecord> Memberships => Set<MembershipRecord>();

    public DbSet<CascadeEntryRecord> CascadeEntries => Set<CascadeEntryRecord>();

    public DbSet<EmployeeRecord> Employees => Set<EmployeeRecord>();

    public DbSet<HireProposalRecord> HireProposals => Set<HireProposalRecord>();

    public DbSet<EmployeeMemoryRecord> EmployeeMemories => Set<EmployeeMemoryRecord>();

    public DbSet<EmployeeMemoryChangeRecord> EmployeeMemoryChanges => Set<EmployeeMemoryChangeRecord>();

    public DbSet<RunRecord> Runs => Set<RunRecord>();

    public DbSet<RunEventRecord> RunEvents => Set<RunEventRecord>();

    public DbSet<TaskRecord> Tasks => Set<TaskRecord>();

    public DbSet<ApprovalRecord> Approvals => Set<ApprovalRecord>();

    public DbSet<IdeaRecord> Ideas => Set<IdeaRecord>();

    public DbSet<ConversationRecord> Conversations => Set<ConversationRecord>();

    public DbSet<ConversationAttachmentRecord> ConversationAttachments => Set<ConversationAttachmentRecord>();

    public DbSet<CreditEntryRecord> CreditEntries => Set<CreditEntryRecord>();

    public DbSet<OperatorActionRecord> OperatorActions => Set<OperatorActionRecord>();

    public DbSet<DataProtectionKey> DataProtectionKeys => Set<DataProtectionKey>();

    public DbSet<AppTokenRecord> AppTokens => Set<AppTokenRecord>();

    public DbSet<AppEndUserRecord> AppEndUsers => Set<AppEndUserRecord>();

    public DbSet<AppEndUserPasskeyRecord> AppEndUserPasskeys => Set<AppEndUserPasskeyRecord>();

    public DbSet<AppSessionRecord> AppSessions => Set<AppSessionRecord>();

    public DbSet<AppHandoffRecord> AppHandoffs => Set<AppHandoffRecord>();

    public DbSet<AppShareRecord> AppShares => Set<AppShareRecord>();

    public DbSet<AppScheduleRecord> AppSchedules => Set<AppScheduleRecord>();

    public DbSet<AppWebhookRecord> AppWebhooks => Set<AppWebhookRecord>();

    public DbSet<EmailMessageRecord> EmailMessages => Set<EmailMessageRecord>();

    public DbSet<TelemetryEventRecord> TelemetryEvents => Set<TelemetryEventRecord>();

    public DbSet<TelemetrySpanRecord> TelemetrySpans => Set<TelemetrySpanRecord>();

    public DbSet<TelemetryMetricRecord> TelemetryMetrics => Set<TelemetryMetricRecord>();

    public DbSet<TelemetryLogRecord> TelemetryLogs => Set<TelemetryLogRecord>();

    public DbSet<HostingSampleRecord> HostingSamples => Set<HostingSampleRecord>();

    public DbSet<AccessTokenRecord> AccessTokens => Set<AccessTokenRecord>();

    public DbSet<NotificationRecord> Notifications => Set<NotificationRecord>();

    public DbSet<NotificationReadRecord> NotificationReads => Set<NotificationReadRecord>();

    public DbSet<IdeaSuggestionRecord> IdeaSuggestions => Set<IdeaSuggestionRecord>();

    public DbSet<SavedQuestionRecord> SavedQuestions => Set<SavedQuestionRecord>();

    public DbSet<TopUpRequestRecord> TopUpRequests => Set<TopUpRequestRecord>();

    public DbSet<PlatformSettingRecord> PlatformSettings => Set<PlatformSettingRecord>();

    public DbSet<PlatformSettingChangeRecord> PlatformSettingChanges => Set<PlatformSettingChangeRecord>();

    public DbSet<PlatformCostRecord> PlatformCosts => Set<PlatformCostRecord>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);
        modelBuilder.Entity<EndgameUser>(b =>
        {
            b.ToTable("users");
            b.Property(u => u.DisplayName).HasColumnName("display_name").HasMaxLength(EndgameUser.MaxDisplayNameLength);
            b.Property(u => u.CreatedAt).HasColumnName("created_at");
            b.Property(u => u.InvitationCodeHash).HasColumnName("invitation_code_hash").HasMaxLength(64);
            b.Property(u => u.InvitationExpiresAt).HasColumnName("invitation_expires_at");
        });
        modelBuilder.Entity<IdentityUserClaim<Guid>>().ToTable("user_claims");
        modelBuilder.Entity<IdentityUserLogin<Guid>>().ToTable("user_logins");
        modelBuilder.Entity<IdentityUserToken<Guid>>().ToTable("user_tokens");
        // Mapped by the base only when the Identity store options ask for schema version 3 (passkeys);
        // IdentityStoreOptions.Apply is what every host and the design-time factory call to ask for it.
        modelBuilder.Entity<IdentityUserPasskey<Guid>>().ToTable("user_passkeys");
        modelBuilder.Entity<DataProtectionKey>().ToTable("data_protection_keys");
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(EndgameDbContext).Assembly);
    }
}

/// <summary>The one place the Identity schema version is chosen: version 3 stores passkeys.</summary>
public static class IdentityStoreOptions
{
    public static void Apply(IdentityOptions options) => options.Stores.SchemaVersion = IdentitySchemaVersions.Version3;
}
