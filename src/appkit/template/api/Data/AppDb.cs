using App.Notes;
using Microsoft.EntityFrameworkCore;

namespace App.Data;

/// <summary>The app's database. Add a DbSet per entity, then `make migration name=AddThing`.</summary>
public sealed class AppDb(DbContextOptions<AppDb> options) : DbContext(options)
{
    public DbSet<Note> Notes => Set<Note>();

    public DbSet<NoteFollow> NoteFollows => Set<NoteFollow>();

    protected override void OnModelCreating(ModelBuilder modelBuilder) =>
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(AppDb).Assembly);
}
