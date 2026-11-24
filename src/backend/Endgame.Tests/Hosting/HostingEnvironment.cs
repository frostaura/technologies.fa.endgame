using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text.Json;
using Endgame.Hosting.Contracts;

namespace Endgame.Tests.Hosting;

/// <summary>
/// A whole hosting stack on the real Docker Engine, named <c>test-endgame-*</c>: PostgreSQL, the
/// egress proxy, Dock (with the socket) and Edge, built from this repository's own Dockerfiles,
/// with the control plane faked in the test process. Two apps are created from the fixture
/// template, built and started once for the whole collection. Everything is removed afterwards.
/// </summary>
public sealed class HostingEnvironment : IAsyncLifetime
{
    public const string Organisation = "acme";
    public const string Division = "apps";
    public const string SubnetPool = "10.214.0.0/16";
    public const string NotesHost = "acme.endgame.test";

    public static readonly Guid OrganisationId = Guid.Parse("a0000000-0000-0000-0000-00000000000a");

    private static readonly TimeSpan Long = TimeSpan.FromMinutes(20);
    private readonly string postgresPassword = Convert.ToHexString(RandomNumberGenerator.GetBytes(12));

    public string Token { get; } = Convert.ToHexString(RandomNumberGenerator.GetBytes(24));

    public string RepositoryRoot { get; } = FindRepositoryRoot();

    public FakeControlPlane ControlPlane { get; private set; } = null!;

    public Uri DockUrl { get; private set; } = null!;

    public Uri EdgeUrl { get; private set; } = null!;

    public Uri EdgeControlUrl { get; private set; } = null!;

    /// <summary>The notes app: public, served at both address shapes, allowed out to example.com.</summary>
    public Guid NotesApp { get; } = Guid.NewGuid();

    /// <summary>The ledger app: public, no outbound allow-list, its own database.</summary>
    public Guid LedgerApp { get; } = Guid.NewGuid();

    public string NotesBuild { get; private set; } = "";

    public TimeSpan BuildTime { get; private set; }

    public TimeSpan WorkspaceImageTime { get; private set; }

    public List<string> Timings { get; } = [];

    public static string Container(string name) => DockerCli.Prefix + name;

    public static string AppContainer(Guid appId) => $"{DockerCli.Prefix}app-{appId:D}";

    public async Task InitializeAsync()
    {
        if (DockerCli.WhyUnavailable is not null)
        {
            return;
        }

        await DockerCli.RemoveEverythingOursAsync();
        ControlPlane = await FakeControlPlane.StartAsync(Token, listenOnAllInterfaces: OperatingSystem.IsLinux());

        var clock = Stopwatch.StartNew();
        await Task.WhenAll(
            DockerCli.CheckedAsync(Long, "build", "-q", "-f", "src/backend/Dockerfile", "--build-arg", "PROJECT=Endgame.Dock", "-t", Container("dock:it"), RepositoryRoot),
            DockerCli.CheckedAsync(Long, "build", "-q", "-f", "src/backend/Dockerfile", "--build-arg", "PROJECT=Endgame.Edge", "-t", Container("edge:it"), RepositoryRoot),
            DockerCli.CheckedAsync(Long, "build", "-q", "-t", Container("egress:it"), Path.Combine(RepositoryRoot, "src", "egress")));
        Timings.Add($"service images built in {clock.Elapsed.TotalSeconds:F0}s");

        var dockPort = FreePort();
        var edgePort = FreePort();
        var edgeControlPort = FreePort();
        DockUrl = new Uri($"http://127.0.0.1:{dockPort}");
        EdgeUrl = new Uri($"http://127.0.0.1:{edgePort}");
        EdgeControlUrl = new Uri($"http://127.0.0.1:{edgeControlPort}");
        var platform = $"http://host.docker.internal:{ControlPlane.Port}";
        string[] hostGateway = ["--add-host", "host.docker.internal:host-gateway"];

        await DockerCli.CheckedAsync("network", "create", "--label", "endgame.test=1", Container("ctl"));
        await DockerCli.CheckedAsync(["run", "-d", "--name", Container("postgres"), "--network", Container("ctl"),
            "-e", $"POSTGRES_PASSWORD={postgresPassword}", "postgres:16.16-alpine"]);
        await DockerCli.CheckedAsync(["run", "-d", "--name", Container("egress"), "--network", Container("ctl"), .. hostGateway, Container("egress:it")]);
        await WaitAsync("PostgreSQL", async () => (await DockerCli.RunAsync(TimeSpan.FromSeconds(10), "exec", Container("postgres"), "pg_isready", "-U", "postgres")).ExitCode == 0, TimeSpan.FromMinutes(1));

        var template = Path.Combine(RepositoryRoot, "src", "backend", "Endgame.Tests", "Hosting", "Fixtures", "app-template");
        await DockerCli.CheckedAsync(
        [
            "run", "-d", "--name", Container("dock"), "--network", Container("ctl"), .. hostGateway,
            "--group-add", SocketGroup(),
            "-v", "/var/run/docker.sock:/var/run/docker.sock",
            "-v", $"{Container("dock-data")}:/data",
            "-v", $"{template}:/opt/endgame/app-template:ro",
            "-p", $"127.0.0.1:{dockPort}:8080",
            "-e", $"{HostingConventions.ServiceTokenVariable}={Token}",
            "-e", $"Dock__ResourcePrefix={DockerCli.Prefix}",
            "-e", "Dock__Instance=test-endgame",
            "-e", $"Dock__SubnetPool={SubnetPool}",
            "-e", $"Dock__WorkspaceImageRepository={Container("workspace")}",
            "-e", $"Dock__SecretKey={Convert.ToHexString(RandomNumberGenerator.GetBytes(24))}",
            "-e", $"Dock__PostgresAdmin=Host={Container("postgres")};Username=postgres;Password={postgresPassword};Database=postgres",
            "-e", $"Dock__Peers__Edge={Container("edge")}",
            "-e", $"Dock__Peers__Postgres={Container("postgres")}",
            "-e", $"Dock__Peers__Egress={Container("egress")}",
            "-e", $"Dock__ControlPlaneUrl={platform}",
            "-e", $"Dock__EdgeControlUrl=http://{Container("edge")}:8081",
            "-e", $"Dock__PlatformUrlForApps={platform}",
            "-e", "Dock__PlatformHost=host.docker.internal",
            "-e", $"Dock__PlatformPort={ControlPlane.Port}",
            "-e", "Dock__LeaseSweepSeconds=2",
            "-e", "Dock__MemorySampleSeconds=2",
            Container("dock:it"),
        ]);
        await DockerCli.CheckedAsync(
        [
            "run", "-d", "--name", Container("edge"), "--network", Container("ctl"), .. hostGateway,
            "-p", $"127.0.0.1:{edgePort}:8080",
            "-p", $"127.0.0.1:{edgeControlPort}:8081",
            "-e", $"{HostingConventions.ServiceTokenVariable}={Token}",
            "-e", $"Edge__ControlPlaneUrl={platform}",
            "-e", $"Edge__DockUrl=http://{Container("dock")}:8080",
            "-e", $"Edge__AppSubnetPools__0={SubnetPool}",
            "-e", "Edge__RoutesPollSeconds=1",
            "-e", "Edge__IdleSweepMilliseconds=250",
            "-e", "Edge__CrashBackoffSeconds=4",
            "-e", "Edge__AccessCacheSeconds=0",
            "-e", $"Edge__PlatformOrigin=http://localhost:{edgePort}",
            "-e", $"ReverseProxy__Clusters__control-plane__Destinations__primary__Address={platform}/",
            "-e", $"ReverseProxy__Clusters__console__Destinations__primary__Address={platform}/",
            Container("edge:it"),
        ]);

        await WaitAsync("Edge", async () => (await Http().GetAsync(new Uri(EdgeUrl, "/health"))).IsSuccessStatusCode, TimeSpan.FromMinutes(1));
        clock.Restart();
        await WaitAsync("Dock's workspace image", async () =>
        {
            using var response = await Http().GetAsync(new Uri(DockUrl, "/health"));
            var body = await response.Content.ReadAsStringAsync();
            if (body.Contains("\"workspaceImage\":\"failed", StringComparison.Ordinal))
            {
                throw new InvalidOperationException("Dock could not build the workspace image: " + body + "\n" + await LogsAsync("dock"));
            }

            return body.Contains("\"workspaceImage\":\"ready\"", StringComparison.Ordinal);
        }, Long);
        WorkspaceImageTime = clock.Elapsed;
        Timings.Add($"workspace image ready in {WorkspaceImageTime.TotalSeconds:F0}s");

        foreach (var (app, allowed) in new[] { (NotesApp, new[] { "example.com" }), (LedgerApp, Array.Empty<string>()) })
        {
            await DockAsync(HttpMethod.Post, "/internal/repos", new CreateRepositoryRequest(app));
            clock.Restart();
            var build = await DockAsync<BuildResult>(HttpMethod.Post, $"/internal/apps/{app:D}/build", new BuildRequest(null));
            if (app == NotesApp)
            {
                BuildTime = clock.Elapsed;
                NotesBuild = build.Image;
                Timings.Add($"first app build in {BuildTime.TotalSeconds:F1}s");
            }

            await DockAsync<AppStatus>(HttpMethod.Post, $"/internal/apps/{app:D}/start", new StartAppRequest(OrganisationId, null, $"app-token-{app:N}", null, allowed));
        }

        PublishRoutes();
        await RefreshEdgeAsync();
    }

    public async Task DisposeAsync()
    {
        if (DockerCli.WhyUnavailable is not null)
        {
            return;
        }

        await ControlPlane.DisposeAsync();
        await DockerCli.RemoveEverythingOursAsync();
    }

    /// <summary>Publishes the routing table, with per-app overrides of the defaults.</summary>
    public void PublishRoutes(SleepPolicy? notesSleep = null, SleepPolicy? ledgerSleep = null, string notesAvailability = AppAvailability.Available)
    {
        ControlPlane.SetRoutes(
            new AppRoute(NotesApp, OrganisationId, Organisation, Division, "notes", [NotesHost], $"http://{AppContainer(NotesApp)}:8080",
                AppAccess.Public, notesSleep ?? new SleepPolicy(false, 3600), notesAvailability),
            new AppRoute(LedgerApp, OrganisationId, Organisation, Division, "ledger", [], $"http://{AppContainer(LedgerApp)}:8080",
                AppAccess.Public, ledgerSleep ?? new SleepPolicy(false, 3600), AppAvailability.Available));
    }

    public async Task RefreshEdgeAsync()
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(EdgeControlUrl, "/internal/routes/refresh"));
        request.Headers.Authorization = new AuthenticationHeaderValue(HostingConventions.ServiceTokenScheme, Token);
        using var response = await Http().SendAsync(request);
        response.EnsureSuccessStatusCode();
    }

    public async Task EdgeControlAsync(HttpMethod method, string path, object? body = null)
    {
        using var request = new HttpRequestMessage(method, new Uri(EdgeControlUrl, path));
        request.Headers.Authorization = new AuthenticationHeaderValue(HostingConventions.ServiceTokenScheme, Token);
        if (body is not null)
        {
            request.Content = JsonContent.Create(body);
        }

        using var response = await Http().SendAsync(request);
        response.EnsureSuccessStatusCode();
    }

    public async Task<JsonElement> EdgeAppsAsync()
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, new Uri(EdgeControlUrl, "/internal/apps"));
        request.Headers.Authorization = new AuthenticationHeaderValue(HostingConventions.ServiceTokenScheme, Token);
        using var response = await Http().SendAsync(request);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    public async Task<HttpResponseMessage> DockAsync(HttpMethod method, string path, object? body = null)
    {
        using var request = new HttpRequestMessage(method, new Uri(DockUrl, path));
        request.Headers.Authorization = new AuthenticationHeaderValue(HostingConventions.ServiceTokenScheme, Token);
        if (body is not null)
        {
            request.Content = JsonContent.Create(body);
        }

        var response = await Http(TimeSpan.FromMinutes(15)).SendAsync(request);
        if (!response.IsSuccessStatusCode && (int)response.StatusCode >= 500)
        {
            var text = await response.Content.ReadAsStringAsync();
            throw new HttpRequestException($"{method} {path} answered {(int)response.StatusCode}: {text}\n--- dock log ---\n{await LogsAsync("dock")}");
        }

        return response;
    }

    public async Task<T> DockAsync<T>(HttpMethod method, string path, object? body = null)
    {
        using var response = await DockAsync(method, path, body);
        if (!response.IsSuccessStatusCode)
        {
            throw new HttpRequestException($"{method} {path} answered {(int)response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
        }

        return (await response.Content.ReadFromJsonAsync<T>())!;
    }

    /// <summary>A client of the edge's public listener, sending <paramref name="host"/> as the Host header.</summary>
    public HttpClient EdgeClient(string? host = null)
    {
        var client = new HttpClient(new SocketsHttpHandler { AllowAutoRedirect = false, UseCookies = false, PooledConnectionLifetime = TimeSpan.Zero })
        {
            BaseAddress = EdgeUrl,
            Timeout = TimeSpan.FromSeconds(60),
        };
        if (host is not null)
        {
            client.DefaultRequestHeaders.Host = host;
        }

        return client;
    }

    public async Task<string> LogsAsync(string name)
    {
        var (_, stdout, stderr) = await DockerCli.RunAsync(TimeSpan.FromSeconds(20), "logs", "--tail", "60", Container(name));
        return stdout + stderr;
    }

    public static async Task WaitAsync(string what, Func<Task<bool>> condition, TimeSpan timeout)
    {
        var clock = Stopwatch.StartNew();
        Exception? last = null;
        while (clock.Elapsed < timeout)
        {
            try
            {
                if (await condition())
                {
                    return;
                }
            }
            catch (Exception e) when (e is HttpRequestException or TaskCanceledException or IOException)
            {
                last = e;
            }

            await Task.Delay(200);
        }

        throw new TimeoutException($"{what} was not ready after {timeout}. {last?.Message}");
    }

    private static HttpClient Http(TimeSpan? timeout = null) => new() { Timeout = timeout ?? TimeSpan.FromSeconds(10) };

    // Docker Desktop's socket is root:root inside its VM, so the group is 0; on Linux, the socket's own.
    private static string SocketGroup()
    {
        if (!OperatingSystem.IsLinux() || !File.Exists("/var/run/docker.sock"))
        {
            return "0";
        }

        var stat = Process.Start(new ProcessStartInfo("stat", ["-c", "%g", "/var/run/docker.sock"]) { RedirectStandardOutput = true })!;
        stat.WaitForExit();
        return stat.StandardOutput.ReadToEnd().Trim();
    }

    private static int FreePort()
    {
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        return ((IPEndPoint)listener.LocalEndpoint).Port;
    }

    private static string FindRepositoryRoot()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            if (File.Exists(Path.Combine(dir.FullName, "src", "backend", "Endgame.slnx")))
            {
                return dir.FullName;
            }
        }

        throw new InvalidOperationException("The repository root was not found above the test output directory.");
    }
}

[CollectionDefinition(Name)]
public sealed class HostingCollection : ICollectionFixture<HostingEnvironment>
{
    public const string Name = "Real Docker hosting";
}
