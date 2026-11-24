using Endgame.Domain.Tree;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Endgame.Infrastructure.Persistence.Configurations;

/// <summary>Organisation slugs are unique everywhere: each becomes a subdomain.</summary>
internal sealed class OrganisationConfiguration : IEntityTypeConfiguration<Organisation>
{
    public void Configure(EntityTypeBuilder<Organisation> builder)
    {
        builder.MapNode("organisations");
        builder.HasIndex(o => o.Slug).IsUnique();
    }
}

/// <summary>
/// Each child carries one required foreign key to its parent, and its slug is unique among its
/// siblings — that is the database's half of "a child belongs to exactly one parent". Deleting a
/// parent with children is refused rather than cascaded: nothing in the tree disappears by accident.
/// </summary>
internal sealed class DivisionConfiguration : IEntityTypeConfiguration<Division>
{
    public void Configure(EntityTypeBuilder<Division> builder)
    {
        builder.MapNode("divisions");
        builder.Property(d => d.OrganisationId).HasColumnName("organisation_id").IsRequired();
        builder.HasOne<Organisation>().WithMany().HasForeignKey(d => d.OrganisationId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(d => new { d.OrganisationId, d.Slug }).IsUnique();
    }
}

internal sealed class ProjectConfiguration : IEntityTypeConfiguration<Project>
{
    public void Configure(EntityTypeBuilder<Project> builder)
    {
        builder.MapNode("projects");
        builder.Property(p => p.DivisionId).HasColumnName("division_id").IsRequired();
        builder.HasOne<Division>().WithMany().HasForeignKey(p => p.DivisionId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(p => new { p.DivisionId, p.Slug }).IsUnique();
    }
}

internal sealed class AppConfiguration : IEntityTypeConfiguration<App>
{
    public void Configure(EntityTypeBuilder<App> builder)
    {
        builder.MapNode("apps");
        builder.Property(a => a.ProjectId).HasColumnName("project_id").IsRequired();
        builder.HasOne<Project>().WithMany().HasForeignKey(a => a.ProjectId).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(a => new { a.ProjectId, a.Slug }).IsUnique();
    }
}
