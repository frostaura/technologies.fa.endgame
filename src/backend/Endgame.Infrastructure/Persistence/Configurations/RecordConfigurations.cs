using Endgame.Domain.Access;
using Endgame.Domain.Cascade;
using Endgame.Domain.Credits;
using Endgame.Domain.Runs;
using Endgame.Domain.Tree;
using Endgame.Domain.Workforce;
using Endgame.Infrastructure.Identity;
using Endgame.Infrastructure.Persistence.Records;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Endgame.Infrastructure.Persistence.Configurations;

internal static class ScopedMapping
{
    /// <summary>
    /// The path columns of a scoped row, each a composite foreign key with the organisation, plus the
    /// rule that a deeper id needs the shallower ones (an app row names its project and division).
    /// </summary>
    public static void MapScope<T>(this EntityTypeBuilder<T> builder, string table)
        where T : class, IScopedRecord
    {
        builder.Property(r => r.OrganisationId).HasColumnName("organisation_id").IsRequired();
        builder.Property(r => r.DivisionId).HasColumnName("division_id");
        builder.Property(r => r.ProjectId).HasColumnName("project_id");
        builder.Property(r => r.AppId).HasColumnName("app_id");
        builder.HasOne<Organisation>().WithMany().HasForeignKey(r => r.OrganisationId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Division>().WithMany()
            .HasForeignKey(r => new { r.OrganisationId, r.DivisionId })
            .HasPrincipalKey(d => new { d.OrganisationId, d.Id })
            .OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<Project>().WithMany()
            .HasForeignKey(r => new { r.OrganisationId, r.DivisionId, r.ProjectId })
            .HasPrincipalKey(p => new { p.OrganisationId, p.DivisionId, p.Id })
            .OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<App>().WithMany()
            .HasForeignKey(r => new { r.OrganisationId, r.ProjectId, r.AppId })
            .HasPrincipalKey(a => new { a.OrganisationId, a.ProjectId, a.Id })
            .OnDelete(DeleteBehavior.Restrict);
        builder.ToTable(table, t => t.HasCheckConstraint($"ck_{table}_path",
            "(app_id IS NULL OR project_id IS NOT NULL) AND (project_id IS NULL OR division_id IS NOT NULL)"));
    }

    public static void Status<T>(this EntityTypeBuilder<T> builder, string table, string column, IEnumerable<string> allowed)
        where T : class =>
        builder.ToTable(table, t => t.HasCheckConstraint($"ck_{table}_{column}", Sql.In(column, allowed)));
}

internal sealed class MembershipConfiguration : IEntityTypeConfiguration<MembershipRecord>
{
    public void Configure(EntityTypeBuilder<MembershipRecord> builder)
    {
        builder.ToTable("memberships");
        builder.HasKey(m => m.Id);
        builder.Property(m => m.Id).HasColumnName("id").ValueGeneratedNever();
        builder.MapScope("memberships");
        builder.Property(m => m.UserId).HasColumnName("user_id");
        builder.Property(m => m.Role).HasColumnName("role").HasMaxLength(20);
        builder.Property(m => m.GrantedBy).HasColumnName("granted_by");
        builder.Property(m => m.GrantedAt).HasColumnName("granted_at");
        builder.Status("memberships", "role", MemberRoles.All);
        builder.HasOne<EndgameUser>().WithMany().HasForeignKey(m => m.UserId).OnDelete(DeleteBehavior.Cascade);
        builder.HasIndex(m => new { m.OrganisationId, m.UserId, m.DivisionId, m.ProjectId, m.AppId }).IsUnique().AreNullsDistinct(false);
        builder.HasIndex(m => m.UserId);
    }
}

internal sealed class CascadeEntryConfiguration : IEntityTypeConfiguration<CascadeEntryRecord>
{
    public void Configure(EntityTypeBuilder<CascadeEntryRecord> builder)
    {
        builder.ToTable("cascade_entries");
        builder.HasKey(e => e.Id);
        builder.Property(e => e.Id).HasColumnName("id").ValueGeneratedNever();
        builder.MapScope("cascade_entries");
        builder.Property(e => e.Kind).HasColumnName("kind").HasMaxLength(20);
        builder.Property(e => e.Key).HasColumnName("key").HasMaxLength(200);
        builder.Property(e => e.ValueJson).HasColumnName("value").HasColumnType("jsonb");
        builder.Property(e => e.ProtectedValue).HasColumnName("protected_value");
        builder.Property(e => e.SetBy).HasColumnName("set_by");
        builder.Property(e => e.SetAt).HasColumnName("set_at");
        // Permissions are role grants in `memberships`; the resolver reads them under this kind.
        builder.Status("cascade_entries", "kind", CascadeKinds.All.Where(k => k != "permission"));
        builder.ToTable(t => t.HasCheckConstraint("ck_cascade_entries_secret",
            "(kind = 'secret') = (protected_value IS NOT NULL)"));
        builder.HasIndex(e => new { e.OrganisationId, e.DivisionId, e.ProjectId, e.AppId, e.Kind, e.Key }).IsUnique().AreNullsDistinct(false);
    }
}

internal sealed class EmployeeConfiguration : IEntityTypeConfiguration<EmployeeRecord>
{
    public void Configure(EntityTypeBuilder<EmployeeRecord> builder)
    {
        builder.ToTable("employees");
        builder.HasKey(e => e.Id);
        builder.HasAlternateKey(e => new { e.OrganisationId, e.Id });
        builder.Property(e => e.Id).HasColumnName("id").ValueGeneratedNever();
        builder.MapScope("employees");
        builder.Property(e => e.Kind).HasColumnName("kind").HasMaxLength(20).HasDefaultValue(EmployeeKinds.Employee);
        builder.Property(e => e.Name).HasColumnName("name").HasMaxLength(200);
        builder.Property(e => e.Role).HasColumnName("role").HasMaxLength(200);
        builder.Property(e => e.JobDescription).HasColumnName("job_description");
        builder.Property(e => e.Tools).HasColumnName("tools").HasDefaultValueSql("'{}'::text[]");
        builder.Property(e => e.Services).HasColumnName("services").HasDefaultValueSql("'{}'::text[]");
        builder.Property(e => e.ModelTier).HasColumnName("model_tier").HasMaxLength(60);
        builder.Property(e => e.Status).HasColumnName("status").HasMaxLength(20);
        builder.Property(e => e.MonthlyCreditLimit).HasColumnName("monthly_credit_limit").HasPrecision(20, 6);
        builder.Property(e => e.ReportsToId).HasColumnName("reports_to");
        builder.Property(e => e.BriefedById).HasColumnName("briefed_by");
        builder.Property(e => e.Brief).HasColumnName("brief");
        builder.Property(e => e.BriefRunId).HasColumnName("brief_run_id");
        builder.Property(e => e.Standing).HasColumnName("standing").HasMaxLength(40);
        builder.Property(e => e.CurrentRunId).HasColumnName("current_run_id");
        builder.Property(e => e.LastRunId).HasColumnName("last_run_id");
        builder.Property(e => e.LastActiveAt).HasColumnName("last_active_at");
        builder.Property(e => e.ReleasedAt).HasColumnName("released_at");
        builder.Property(e => e.CreatedAt).HasColumnName("created_at");
        builder.Status("employees", "status", EmployeeStatuses.All);
        builder.Status("employees", "kind", EmployeeKinds.All);
        builder.ToTable(t =>
        {
            t.HasCheckConstraint("ck_employees_limit", "monthly_credit_limit IS NULL OR monthly_credit_limit >= 0");
            t.HasCheckConstraint("ck_employees_contractor", "(kind = 'contractor') = (briefed_by IS NOT NULL)");
            t.HasCheckConstraint("ck_employees_released", "(status = 'released') = (released_at IS NOT NULL)");
            t.HasCheckConstraint("ck_employees_standing", $"standing IS NULL OR (kind = 'employee' AND {Sql.In("standing", StandingRoles.All)})");
            t.HasCheckConstraint("ck_employees_not_self", "reports_to IS NULL OR reports_to <> id");
        });
        builder.HasOne<EmployeeRecord>().WithMany()
            .HasForeignKey(e => new { e.OrganisationId, e.ReportsToId })
            .HasPrincipalKey(e => new { e.OrganisationId, e.Id })
            .OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<EmployeeRecord>().WithMany()
            .HasForeignKey(e => new { e.OrganisationId, e.BriefedById })
            .HasPrincipalKey(e => new { e.OrganisationId, e.Id })
            .OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<RunRecord>().WithMany()
            .HasForeignKey(e => new { e.OrganisationId, e.BriefRunId })
            .HasPrincipalKey(r => new { r.OrganisationId, r.Id })
            .OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(e => new { e.OrganisationId, e.Standing }).IsUnique().HasFilter("standing IS NOT NULL");
        builder.HasIndex(e => new { e.OrganisationId, e.BriefedById });
    }
}

internal sealed class HireProposalConfiguration : IEntityTypeConfiguration<HireProposalRecord>
{
    public void Configure(EntityTypeBuilder<HireProposalRecord> builder)
    {
        builder.ToTable("hire_proposals");
        builder.HasKey(h => h.Id);
        builder.HasAlternateKey(h => new { h.OrganisationId, h.Id });
        builder.Property(h => h.Id).HasColumnName("id").ValueGeneratedNever();
        builder.MapScope("hire_proposals");
        builder.Property(h => h.Status).HasColumnName("status").HasMaxLength(20);
        builder.Property(h => h.Trigger).HasColumnName("trigger").HasMaxLength(20);
        builder.Property(h => h.NeedKey).HasColumnName("need_key").HasMaxLength(200);
        builder.Property(h => h.Reason).HasColumnName("reason");
        builder.Property(h => h.Name).HasColumnName("name").HasMaxLength(200);
        builder.Property(h => h.Role).HasColumnName("role").HasMaxLength(200);
        builder.Property(h => h.Mandate).HasColumnName("mandate");
        builder.Property(h => h.Tools).HasColumnName("tools");
        builder.Property(h => h.Services).HasColumnName("services");
        builder.Property(h => h.MonthlyCreditLimit).HasColumnName("monthly_credit_limit").HasPrecision(20, 6);
        builder.Property(h => h.ModelTier).HasColumnName("model_tier").HasMaxLength(60);
        builder.Property(h => h.ReportsToId).HasColumnName("reports_to");
        builder.Property(h => h.ExpectedMonthlyCredits).HasColumnName("expected_monthly_credits").HasPrecision(20, 6);
        builder.Property(h => h.ContractorRole).HasColumnName("contractor_role").HasMaxLength(200);
        builder.Property(h => h.RaisedByUserId).HasColumnName("raised_by_user_id");
        builder.Property(h => h.RaisedByRunId).HasColumnName("raised_by_run_id");
        builder.Property(h => h.DecidedVia).HasColumnName("decided_via").HasMaxLength(20);
        builder.Property(h => h.DecidedBy).HasColumnName("decided_by");
        builder.Property(h => h.DecidedAt).HasColumnName("decided_at");
        builder.Property(h => h.DecisionNote).HasColumnName("decision_note");
        builder.Property(h => h.EmployeeId).HasColumnName("employee_id");
        builder.Property(h => h.CreatedAt).HasColumnName("created_at");
        builder.Property(h => h.UpdatedAt).HasColumnName("updated_at");
        builder.Status("hire_proposals", "status", HireStatuses.All);
        builder.Status("hire_proposals", "trigger", HireTriggers.All);
        builder.ToTable(t =>
        {
            t.HasCheckConstraint("ck_hire_proposals_decided", $"(status = 'proposed') = (decided_at IS NULL) AND (decided_via IS NULL OR {Sql.In("decided_via", IdeaDecisions.Via)}) AND (status = 'proposed') = (decided_via IS NULL)");
            t.HasCheckConstraint("ck_hire_proposals_employee", "(status = 'accepted') = (employee_id IS NOT NULL)");
            t.HasCheckConstraint("ck_hire_proposals_credits", "expected_monthly_credits >= 0 AND (monthly_credit_limit IS NULL OR monthly_credit_limit >= 0)");
        });
        builder.HasOne<EmployeeRecord>().WithMany()
            .HasForeignKey(h => new { h.OrganisationId, h.EmployeeId })
            .HasPrincipalKey(e => new { e.OrganisationId, e.Id })
            .OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<EmployeeRecord>().WithMany()
            .HasForeignKey(h => new { h.OrganisationId, h.ReportsToId })
            .HasPrincipalKey(e => new { e.OrganisationId, e.Id })
            .OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<RunRecord>().WithMany()
            .HasForeignKey(h => new { h.OrganisationId, h.RaisedByRunId })
            .HasPrincipalKey(r => new { r.OrganisationId, r.Id })
            .OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<EndgameUser>().WithMany().HasForeignKey(h => h.RaisedByUserId).OnDelete(DeleteBehavior.SetNull);
        // One live proposal (or hire) per need: raising the same need again finds it.
        builder.HasIndex(h => new { h.OrganisationId, h.NeedKey }).IsUnique().HasFilter("need_key IS NOT NULL AND status <> 'declined'");
        builder.HasIndex(h => new { h.OrganisationId, h.Status });
    }
}

internal sealed class EmployeeMemoryConfiguration : IEntityTypeConfiguration<EmployeeMemoryRecord>
{
    public void Configure(EntityTypeBuilder<EmployeeMemoryRecord> builder)
    {
        builder.ToTable("employee_memories");
        builder.HasKey(m => m.Id);
        builder.Property(m => m.Id).HasColumnName("id").ValueGeneratedNever();
        builder.MapScope("employee_memories");
        builder.Property(m => m.EmployeeId).HasColumnName("employee_id");
        builder.Property(m => m.Title).HasColumnName("title").HasMaxLength(WorkforceLimits.MaxMemoryTitle);
        builder.Property(m => m.Body).HasColumnName("body");
        builder.Property(m => m.Kind).HasColumnName("kind").HasMaxLength(20);
        builder.Property(m => m.SourceRunId).HasColumnName("source_run_id");
        builder.Property(m => m.CreatedAt).HasColumnName("created_at");
        builder.Property(m => m.UpdatedAt).HasColumnName("updated_at");
        builder.Property(m => m.LastReviewedAt).HasColumnName("last_reviewed_at");
        builder.Property(m => m.ArchivedAt).HasColumnName("archived_at");
        builder.Status("employee_memories", "kind", MemoryKinds.All);
        builder.ToTable(t => t.HasCheckConstraint("ck_employee_memories_body", $"length(body) BETWEEN 1 AND {WorkforceLimits.MaxMemoryBody} AND length(title) >= 1"));
        builder.HasOne<EmployeeRecord>().WithMany()
            .HasForeignKey(m => new { m.OrganisationId, m.EmployeeId })
            .HasPrincipalKey(e => new { e.OrganisationId, e.Id })
            .OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<RunRecord>().WithMany()
            .HasForeignKey(m => new { m.OrganisationId, m.SourceRunId })
            .HasPrincipalKey(r => new { r.OrganisationId, r.Id })
            .OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(m => new { m.OrganisationId, m.EmployeeId, m.ArchivedAt });
    }
}

internal sealed class EmployeeMemoryChangeConfiguration : IEntityTypeConfiguration<EmployeeMemoryChangeRecord>
{
    public void Configure(EntityTypeBuilder<EmployeeMemoryChangeRecord> builder)
    {
        builder.ToTable("employee_memory_changes");
        builder.HasKey(c => c.Id);
        builder.Property(c => c.Id).HasColumnName("id").ValueGeneratedNever();
        builder.Property(c => c.OrganisationId).HasColumnName("organisation_id");
        builder.Property(c => c.EmployeeId).HasColumnName("employee_id");
        builder.Property(c => c.MemoryId).HasColumnName("memory_id");
        builder.Property(c => c.Action).HasColumnName("action").HasMaxLength(20);
        builder.Property(c => c.By).HasColumnName("by").HasMaxLength(20);
        builder.Property(c => c.UserId).HasColumnName("user_id");
        builder.Property(c => c.RunId).HasColumnName("run_id");
        builder.Property(c => c.DetailJson).HasColumnName("detail").HasColumnType("jsonb");
        builder.Property(c => c.At).HasColumnName("at");
        builder.Status("employee_memory_changes", "action", MemoryActions.All);
        builder.Status("employee_memory_changes", "by", MemoryActors.All);
        builder.HasOne<EmployeeRecord>().WithMany()
            .HasForeignKey(c => new { c.OrganisationId, c.EmployeeId })
            .HasPrincipalKey(e => new { e.OrganisationId, e.Id })
            .OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<RunRecord>().WithMany()
            .HasForeignKey(c => new { c.OrganisationId, c.RunId })
            .HasPrincipalKey(r => new { r.OrganisationId, r.Id })
            .OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(c => new { c.OrganisationId, c.EmployeeId, c.At });
    }
}

internal sealed class RunConfiguration : IEntityTypeConfiguration<RunRecord>
{
    public void Configure(EntityTypeBuilder<RunRecord> builder)
    {
        builder.ToTable("runs");
        builder.HasKey(r => r.Id);
        builder.HasAlternateKey(r => new { r.OrganisationId, r.Id });
        builder.Property(r => r.Id).HasColumnName("id").ValueGeneratedNever();
        builder.MapScope("runs");
        builder.Property(r => r.Kind).HasColumnName("kind").HasMaxLength(20);
        builder.Property(r => r.Status).HasColumnName("status").HasMaxLength(20);
        builder.Property(r => r.Title).HasColumnName("title").HasMaxLength(300);
        builder.Property(r => r.EmployeeId).HasColumnName("employee_id");
        builder.Property(r => r.IdeaId).HasColumnName("idea_id");
        builder.Property(r => r.ConversationId).HasColumnName("conversation_id");
        builder.Property(r => r.ParentRunId).HasColumnName("parent_run_id");
        builder.Property(r => r.LeaseHolder).HasColumnName("lease_holder").HasMaxLength(200);
        builder.Property(r => r.LeaseExpiresAt).HasColumnName("lease_expires_at");
        builder.Property(r => r.LastSeq).HasColumnName("last_seq");
        builder.Property(r => r.BudgetExhaustedAt).HasColumnName("budget_exhausted_at");
        builder.Property(r => r.Outcome).HasColumnName("outcome").HasMaxLength(20);
        builder.Property(r => r.Summary).HasColumnName("summary");
        builder.Property(r => r.CreatedBy).HasColumnName("created_by");
        builder.Property(r => r.CreatedAt).HasColumnName("created_at");
        builder.Property(r => r.StartedAt).HasColumnName("started_at");
        builder.Property(r => r.FinishedAt).HasColumnName("finished_at");
        builder.Status("runs", "status", RunStatuses.All);
        builder.Status("runs", "kind", RunKinds.All);
        builder.ToTable(t =>
        {
            t.HasCheckConstraint("ck_runs_finished", $"({Sql.In("status", RunStatuses.Terminal)}) = (finished_at IS NOT NULL)");
            t.HasCheckConstraint("ck_runs_seq", "last_seq >= 0");
        });
        builder.HasOne<EmployeeRecord>().WithMany()
            .HasForeignKey(r => new { r.OrganisationId, r.EmployeeId })
            .HasPrincipalKey(e => new { e.OrganisationId, e.Id })
            .OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<RunRecord>().WithMany()
            .HasForeignKey(r => new { r.OrganisationId, r.ParentRunId })
            .HasPrincipalKey(r => new { r.OrganisationId, r.Id })
            .OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<IdeaRecord>().WithMany()
            .HasForeignKey(r => new { r.OrganisationId, r.IdeaId })
            .HasPrincipalKey(i => new { i.OrganisationId, i.Id })
            .OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<ConversationRecord>().WithMany()
            .HasForeignKey(r => new { r.OrganisationId, r.ConversationId })
            .HasPrincipalKey(c => new { c.OrganisationId, c.Id })
            .OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(r => new { r.Status, r.CreatedAt });
    }
}

internal sealed class RunEventConfiguration : IEntityTypeConfiguration<RunEventRecord>
{
    public void Configure(EntityTypeBuilder<RunEventRecord> builder)
    {
        builder.ToTable("run_events");
        builder.HasKey(e => new { e.OrganisationId, e.RunId, e.Seq });
        builder.Property(e => e.OrganisationId).HasColumnName("organisation_id");
        builder.Property(e => e.RunId).HasColumnName("run_id");
        builder.Property(e => e.Seq).HasColumnName("seq");
        builder.Property(e => e.Type).HasColumnName("type").HasMaxLength(40);
        builder.Property(e => e.At).HasColumnName("at");
        builder.Property(e => e.PayloadJson).HasColumnName("payload").HasColumnType("jsonb");
        builder.Status("run_events", "type", RunEventTypes.All);
        builder.ToTable(t => t.HasCheckConstraint("ck_run_events_seq", "seq >= 1"));
        builder.HasOne<RunRecord>().WithMany()
            .HasForeignKey(e => new { e.OrganisationId, e.RunId })
            .HasPrincipalKey(r => new { r.OrganisationId, r.Id })
            .OnDelete(DeleteBehavior.Restrict);
    }
}

internal sealed class TaskConfiguration : IEntityTypeConfiguration<TaskRecord>
{
    public void Configure(EntityTypeBuilder<TaskRecord> builder)
    {
        builder.ToTable("tasks");
        builder.HasKey(t => t.Id);
        builder.HasAlternateKey(t => new { t.OrganisationId, t.Id });
        builder.Property(t => t.Id).HasColumnName("id").ValueGeneratedNever();
        builder.MapScope("tasks");
        builder.Property(t => t.RunId).HasColumnName("run_id");
        builder.Property(t => t.ParentTaskId).HasColumnName("parent_task_id");
        builder.Property(t => t.Title).HasColumnName("title").HasMaxLength(300);
        builder.Property(t => t.Description).HasColumnName("description");
        builder.Property(t => t.Status).HasColumnName("status").HasMaxLength(20);
        builder.Property(t => t.HolderRunId).HasColumnName("holder_run_id");
        builder.Property(t => t.HolderEmployeeId).HasColumnName("holder_employee_id");
        builder.Property(t => t.EmployeeId).HasColumnName("employee_id");
        builder.Property(t => t.ClaimedAt).HasColumnName("claimed_at");
        builder.Property(t => t.EstimateCredits).HasColumnName("estimate_credits").HasPrecision(20, 6);
        builder.Property(t => t.ActualCredits).HasColumnName("actual_credits").HasPrecision(20, 6);
        builder.Property(t => t.DependsOn).HasColumnName("depends_on");
        builder.Property(t => t.CreatedAt).HasColumnName("created_at");
        builder.Property(t => t.UpdatedAt).HasColumnName("updated_at");
        builder.Status("tasks", "status", TaskStatuses.All);
        builder.ToTable(t => t.HasCheckConstraint("ck_tasks_holder", "(status = 'in_progress') = (holder_run_id IS NOT NULL)"));
        builder.HasOne<RunRecord>().WithMany()
            .HasForeignKey(t => new { t.OrganisationId, t.RunId })
            .HasPrincipalKey(r => new { r.OrganisationId, r.Id })
            .OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<RunRecord>().WithMany()
            .HasForeignKey(t => new { t.OrganisationId, t.HolderRunId })
            .HasPrincipalKey(r => new { r.OrganisationId, r.Id })
            .OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<EmployeeRecord>().WithMany()
            .HasForeignKey(t => new { t.OrganisationId, t.HolderEmployeeId })
            .HasPrincipalKey(e => new { e.OrganisationId, e.Id })
            .OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<EmployeeRecord>().WithMany()
            .HasForeignKey(t => new { t.OrganisationId, t.EmployeeId })
            .HasPrincipalKey(e => new { e.OrganisationId, e.Id })
            .OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<TaskRecord>().WithMany()
            .HasForeignKey(t => new { t.OrganisationId, t.ParentTaskId })
            .HasPrincipalKey(t => new { t.OrganisationId, t.Id })
            .OnDelete(DeleteBehavior.Restrict);
    }
}

internal sealed class ApprovalConfiguration : IEntityTypeConfiguration<ApprovalRecord>
{
    public void Configure(EntityTypeBuilder<ApprovalRecord> builder)
    {
        builder.ToTable("approvals");
        builder.HasKey(a => a.Id);
        builder.Property(a => a.Id).HasColumnName("id").ValueGeneratedNever();
        builder.Property(a => a.OrganisationId).HasColumnName("organisation_id");
        builder.Property(a => a.RunId).HasColumnName("run_id");
        builder.Property(a => a.Title).HasColumnName("title").HasMaxLength(300);
        builder.Property(a => a.Detail).HasColumnName("detail");
        builder.Property(a => a.Status).HasColumnName("status").HasMaxLength(20);
        builder.Property(a => a.RequestedAt).HasColumnName("requested_at");
        builder.Property(a => a.AnsweredAt).HasColumnName("answered_at");
        builder.Property(a => a.AnsweredBy).HasColumnName("answered_by");
        builder.Property(a => a.Comment).HasColumnName("comment");
        builder.Status("approvals", "status", ApprovalStatuses.All);
        builder.ToTable(t => t.HasCheckConstraint("ck_approvals_answered", "(status = 'pending') = (answered_at IS NULL)"));
        builder.HasOne<RunRecord>().WithMany()
            .HasForeignKey(a => new { a.OrganisationId, a.RunId })
            .HasPrincipalKey(r => new { r.OrganisationId, r.Id })
            .OnDelete(DeleteBehavior.Restrict);
    }
}

internal sealed class IdeaConfiguration : IEntityTypeConfiguration<IdeaRecord>
{
    public void Configure(EntityTypeBuilder<IdeaRecord> builder)
    {
        builder.ToTable("ideas");
        builder.HasKey(i => i.Id);
        builder.HasAlternateKey(i => new { i.OrganisationId, i.Id });
        builder.Property(i => i.Id).HasColumnName("id").ValueGeneratedNever();
        builder.MapScope("ideas");
        builder.Property(i => i.Text).HasColumnName("text");
        builder.Property(i => i.Constraints).HasColumnName("constraints");
        builder.Property(i => i.Status).HasColumnName("status").HasMaxLength(20);
        builder.Property(i => i.ResearchEstimateCredits).HasColumnName("research_estimate_credits").HasPrecision(20, 6);
        builder.Property(i => i.Verdict).HasColumnName("verdict").HasMaxLength(20);
        builder.Property(i => i.VerdictSummary).HasColumnName("verdict_summary");
        builder.Property(i => i.VerdictEvidenceJson).HasColumnName("verdict_evidence").HasColumnType("jsonb");
        builder.Property(i => i.Overruled).HasColumnName("overruled");
        builder.Property(i => i.Decision).HasColumnName("decision").HasMaxLength(20);
        builder.Property(i => i.DecisionNote).HasColumnName("decision_note");
        builder.Property(i => i.DecidedBy).HasColumnName("decided_by");
        builder.Property(i => i.DecidedAt).HasColumnName("decided_at");
        builder.Property(i => i.DecidedVia).HasColumnName("decided_via").HasMaxLength(20);
        builder.Property(i => i.RedLine).HasColumnName("red_line").HasMaxLength(300);
        builder.Property(i => i.ResearchRunId).HasColumnName("research_run_id");
        builder.Property(i => i.BuildRunId).HasColumnName("build_run_id");
        builder.Property(i => i.CreatedBy).HasColumnName("created_by");
        builder.Property(i => i.CreatedAt).HasColumnName("created_at");
        builder.Status("ideas", "status", IdeaStatuses.All);
        builder.ToTable(t =>
        {
            t.HasCheckConstraint("ck_ideas_verdict", $"verdict IS NULL OR {Sql.In("verdict", Verdicts.All)}");
            t.HasCheckConstraint("ck_ideas_decision", $"decision IS NULL OR {Sql.In("decision", IdeaDecisions.All)}");
            t.HasCheckConstraint("ck_ideas_decided_via", $"(decision IS NULL) = (decided_via IS NULL) AND (decided_via IS NULL OR {Sql.In("decided_via", IdeaDecisions.Via)})");
            // A breached red line is never built over: the database refuses it as well as the service.
            t.HasCheckConstraint("ck_ideas_red_line", "red_line IS NULL OR decision IS NULL OR decision IN ('change', 'drop')");
        });
        builder.HasOne<RunRecord>().WithMany()
            .HasForeignKey(i => new { i.OrganisationId, i.ResearchRunId })
            .HasPrincipalKey(r => new { r.OrganisationId, r.Id })
            .OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<RunRecord>().WithMany()
            .HasForeignKey(i => new { i.OrganisationId, i.BuildRunId })
            .HasPrincipalKey(r => new { r.OrganisationId, r.Id })
            .OnDelete(DeleteBehavior.Restrict);
    }
}

internal sealed class ConversationConfiguration : IEntityTypeConfiguration<ConversationRecord>
{
    public void Configure(EntityTypeBuilder<ConversationRecord> builder)
    {
        builder.ToTable("conversations");
        builder.HasKey(c => c.Id);
        builder.HasAlternateKey(c => new { c.OrganisationId, c.Id });
        builder.Property(c => c.Id).HasColumnName("id").ValueGeneratedNever();
        builder.MapScope("conversations");
        builder.Property(c => c.EmployeeId).HasColumnName("employee_id");
        builder.Property(c => c.CreatedBy).HasColumnName("created_by");
        builder.Property(c => c.CreatedAt).HasColumnName("created_at");
        builder.Property(c => c.LastRunId).HasColumnName("last_run_id");
        builder.HasOne<EmployeeRecord>().WithMany()
            .HasForeignKey(c => new { c.OrganisationId, c.EmployeeId })
            .HasPrincipalKey(e => new { e.OrganisationId, e.Id })
            .OnDelete(DeleteBehavior.Restrict);
    }
}

internal sealed class CreditEntryConfiguration : IEntityTypeConfiguration<CreditEntryRecord>
{
    public void Configure(EntityTypeBuilder<CreditEntryRecord> builder)
    {
        builder.ToTable("credit_entries");
        builder.HasKey(e => e.Id);
        builder.HasAlternateKey(e => new { e.OrganisationId, e.Id });
        builder.Property(e => e.Id).HasColumnName("id").ValueGeneratedNever();
        builder.MapScope("credit_entries");
        builder.Property(e => e.Kind).HasColumnName("kind").HasMaxLength(20);
        builder.Property(e => e.Amount).HasColumnName("amount").HasPrecision(20, 6);
        builder.Property(e => e.ReservationId).HasColumnName("reservation_id");
        builder.Property(e => e.EmployeeId).HasColumnName("employee_id");
        builder.Property(e => e.RunId).HasColumnName("run_id");
        builder.Property(e => e.TaskType).HasColumnName("task_type").HasMaxLength(60);
        builder.Property(e => e.Model).HasColumnName("model").HasMaxLength(200);
        builder.Property(e => e.Billable).HasColumnName("billable");
        builder.Property(e => e.CostUsd).HasColumnName("cost_usd").HasPrecision(20, 10);
        builder.Property(e => e.GenerationId).HasColumnName("generation_id").HasMaxLength(200);
        builder.Property(e => e.ExpiresAt).HasColumnName("expires_at");
        builder.Property(e => e.IdempotencyKey).HasColumnName("idempotency_key").HasMaxLength(200);
        builder.Property(e => e.Note).HasColumnName("note").HasMaxLength(500);
        builder.Property(e => e.CreatedBy).HasColumnName("created_by");
        builder.Property(e => e.CreatedAt).HasColumnName("created_at");
        builder.Status("credit_entries", "kind", CreditEntryKinds.All);
        builder.ToTable(t =>
        {
            t.HasCheckConstraint("ck_credit_entries_amount", "amount >= 0");
            t.HasCheckConstraint("ck_credit_entries_reservation",
                "(kind = 'reservation') = (expires_at IS NOT NULL) AND (kind IN ('settlement', 'release')) = (reservation_id IS NOT NULL)");
            t.HasCheckConstraint("ck_credit_entries_top_up", "kind <> 'top_up' OR (division_id IS NULL AND billable)");
        });
        builder.HasOne<CreditEntryRecord>().WithMany()
            .HasForeignKey(e => new { e.OrganisationId, e.ReservationId })
            .HasPrincipalKey(e => new { e.OrganisationId, e.Id })
            .OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<RunRecord>().WithMany()
            .HasForeignKey(e => new { e.OrganisationId, e.RunId })
            .HasPrincipalKey(r => new { r.OrganisationId, r.Id })
            .OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<EmployeeRecord>().WithMany()
            .HasForeignKey(e => new { e.OrganisationId, e.EmployeeId })
            .HasPrincipalKey(r => new { r.OrganisationId, r.Id })
            .OnDelete(DeleteBehavior.Restrict);
        // A reservation is closed at most once by each kind of closing entry.
        builder.HasIndex(e => new { e.OrganisationId, e.ReservationId, e.Kind }).IsUnique().HasFilter("reservation_id IS NOT NULL");
        builder.HasIndex(e => new { e.OrganisationId, e.IdempotencyKey }).IsUnique().HasFilter("idempotency_key IS NOT NULL");
        builder.HasIndex(e => new { e.OrganisationId, e.Kind, e.CreatedAt });
        builder.HasIndex(e => e.RunId);
    }
}

internal sealed class OperatorActionConfiguration : IEntityTypeConfiguration<OperatorActionRecord>
{
    public void Configure(EntityTypeBuilder<OperatorActionRecord> builder)
    {
        builder.ToTable("operator_actions");
        builder.HasKey(a => a.Id);
        builder.Property(a => a.Id).HasColumnName("id").ValueGeneratedNever();
        builder.Property(a => a.OrganisationId).HasColumnName("organisation_id");
        builder.Property(a => a.OperatorUserId).HasColumnName("operator_user_id");
        builder.Property(a => a.Action).HasColumnName("action").HasMaxLength(60);
        builder.Property(a => a.DetailJson).HasColumnName("detail").HasColumnType("jsonb");
        builder.Property(a => a.At).HasColumnName("at");
        builder.HasOne<Organisation>().WithMany().HasForeignKey(a => a.OrganisationId).OnDelete(DeleteBehavior.Restrict);
    }
}
