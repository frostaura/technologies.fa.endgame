using System.Collections.Concurrent;
using Endgame.Edge.Routing;

namespace Endgame.Edge.Runtime;

/// <summary>Every routed app's runtime state, kept in step with the routing table.</summary>
public sealed class AppRegistry(TimeProvider time)
{
    private readonly ConcurrentDictionary<Guid, AppRuntime> apps = new();

    public AppRuntime? Get(Guid appId) => apps.GetValueOrDefault(appId);

    public IEnumerable<AppRuntime> All => apps.Values;

    /// <summary>Adds new apps, refreshes known ones, forgets removed ones. Returns the new ones.</summary>
    public IReadOnlyList<AppRuntime> Apply(RouteSnapshot snapshot)
    {
        var added = new List<AppRuntime>();
        foreach (var route in snapshot.Apps)
        {
            var runtime = apps.GetOrAdd(route.AppId, _ =>
            {
                var created = new AppRuntime(route, time);
                added.Add(created);
                return created;
            });
            runtime.Route = route;
        }

        foreach (var id in apps.Keys.Where(id => !snapshot.ById.ContainsKey(id)).ToList())
        {
            apps.TryRemove(id, out _);
        }

        return added;
    }
}
