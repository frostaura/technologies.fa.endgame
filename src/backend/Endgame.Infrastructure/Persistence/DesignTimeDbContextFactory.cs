using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Endgame.Infrastructure.Persistence;

/// <summary>
/// Lets <c>dotnet ef migrations add</c> build the model without starting a host. Scaffolding a
/// migration never connects, so the connection string only has to parse; `ENDGAME_DESIGN_CONNECTION`
/// overrides it for commands that do connect, such as <c>dotnet ef database update</c>.
/// </summary>
internal sealed class DesignTimeDbContextFactory : IDesignTimeDbContextFactory<EndgameDbContext>
{
    public EndgameDbContext CreateDbContext(string[] args)
    {
        var connection = Environment.GetEnvironmentVariable("ENDGAME_DESIGN_CONNECTION")
            ?? "Host=localhost;Port=5446;Database=endgame;Username=endgame";
        var options = new DbContextOptionsBuilder<EndgameDbContext>().UseNpgsql(connection).Options;
        return new EndgameDbContext(options);
    }
}
