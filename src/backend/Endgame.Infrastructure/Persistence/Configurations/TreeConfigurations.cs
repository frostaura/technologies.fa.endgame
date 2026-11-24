using Endgame.Domain.Tree;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Endgame.Infrastructure.Persistence.Configurations;

/// <summary>Organisation slugs are unique everywhere: each becomes a subdomain. Its id is its organisation id.</summary>
internal sealed class OrganisationConfiguration : IEntityTypeConfiguration<Organisation>
{
    public void Configure(EntityTypeBuilder<Organisation> builder)
    {
        builder.MapNode("organisations", NodeLevel.Organisation);
        builder.ToTable(t => t.HasCheckConstraint("ck_organisations_self", "organisation_id = id"));
        builder.HasIndex(o => o.Slug).IsUnique();
    }
}

/// <summary>
/// Each child carries a composite foreign key to its parent through the organisation, and its slug
/// is unique among its siblings — the database's half of "a child belongs to exactly one parent", and
/// of "no row can point into another organisation". Deleting a parent with children is refused.
/// </summary>
internal sealed class DivisionConfiguration : IEntityTypeConfiguration<Division>
{
    public void Configure(EntityTypeBuilder<Division> builder)
    {
        builder.MapNode("divisions", NodeLevel.Division);
        builder.HasAlternateKey(d => new { d.OrganisationId, d.Id });
        builder.HasOne<Organisation>().WithMany().HasForeignKey(d => d.OrganisationId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(d => new { d.OrganisationId, d.Slug }).IsUnique();
    }
}

internal sealed class ProjectConfiguration : IEntityTypeConfiguration<Project>
{
    public void Configure(EntityTypeBuilder<Project> builder)
    {
        builder.MapNode("projects", NodeLevel.Project);
        builder.Property(p => p.DivisionId).HasColumnName("division_id").IsRequired();
        builder.HasAlternateKey(p => new { p.OrganisationId, p.Id });
        builder.HasAlternateKey(p => new { p.OrganisationId, p.DivisionId, p.Id });
        builder.HasOne<Division>().WithMany()
            .HasForeignKey(p => new { p.OrganisationId, p.DivisionId })
            .HasPrincipalKey(d => new { d.OrganisationId, d.Id })
            .OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(p => new { p.DivisionId, p.Slug }).IsUnique();
    }
}

internal sealed class AppConfiguration : IEntityTypeConfiguration<App>
{
    public void Configure(EntityTypeBuilder<App> builder)
    {
        builder.MapNode("apps", NodeLevel.App);
        builder.Property(a => a.ProjectId).HasColumnName("project_id").IsRequired();
        builder.Property(a => a.CurrentVersion).HasColumnName("current_version").HasMaxLength(App.MaxVersionLength);
        builder.Property(a => a.PublishedAt).HasColumnName("published_at");
        builder.HasAlternateKey(a => new { a.OrganisationId, a.Id });
        builder.HasAlternateKey(a => new { a.OrganisationId, a.ProjectId, a.Id });
        builder.HasOne<Project>().WithMany()
            .HasForeignKey(a => new { a.OrganisationId, a.ProjectId })
            .HasPrincipalKey(p => new { p.OrganisationId, p.Id })
            .OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(a => new { a.ProjectId, a.Slug }).IsUnique();
    }
}
