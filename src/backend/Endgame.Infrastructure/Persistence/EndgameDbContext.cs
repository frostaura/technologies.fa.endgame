using Endgame.Domain.Tree;
using Microsoft.EntityFrameworkCore;

namespace Endgame.Infrastructure.Persistence;

/// <summary>The platform's own database: the cascade tree, and in later phases everything that hangs off it.</summary>
public sealed class EndgameDbContext(DbContextOptions<EndgameDbContext> options) : DbContext(options)
{
    public DbSet<Organisation> Organisations => Set<Organisation>();

    public DbSet<Division> Divisions => Set<Division>();

    public DbSet<Project> Projects => Set<Project>();

    public DbSet<App> Apps => Set<App>();

    protected override void OnModelCreating(ModelBuilder modelBuilder) =>
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(EndgameDbContext).Assembly);
}
