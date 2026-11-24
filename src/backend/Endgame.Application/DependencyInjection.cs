using Endgame.Application.Status;
using Microsoft.Extensions.DependencyInjection;

namespace Endgame.Application;

public static class DependencyInjection
{
    public static IServiceCollection AddEndgameApplication(this IServiceCollection services)
    {
        services.AddSingleton(TimeProvider.System);
        services.AddScoped<GetSystemStatus>();
        return services;
    }
}
