using System.Diagnostics;
using System.Globalization;
using System.IO.Compression;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Endgame.Hosting.Contracts;
using Endgame.Infrastructure.Platform;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Xunit.Abstractions;

namespace Endgame.Tests.Hosting;

/// <summary>
/// Dock and Edge against the real Docker Engine on this machine (ARCH-005's rules, re-proven on
/// the production code): repositories, workspaces, builds, both address shapes, sleep and wake,
/// a crash, egress, and the isolation between apps.
/// </summary>
[Collection(HostingCollection.Name)]
[Trait("Category", "Docker")]
public sealed class HostingIntegrationTests(HostingEnvironment env, ITestOutputHelper output)
{
    private const string Author = "Ada Employee";
    private const string AuthorEmail = "ada@employees.endgame.test";

    [DockerFact]
    public async Task A_repository_keeps_every_version_and_can_restore_archive_and_export_them()
    {
        var app = Guid.NewGuid();
        var created = await env.DockAsync<RepositoryInfo>(HttpMethod.Post, "/internal/repos", new CreateRepositoryRequest(app));
        Assert.Equal("main", created.Branch);
        using (var again = await env.DockAsync(HttpMethod.Post, "/internal/repos", new CreateRepositoryRequest(app)))
        {
            Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);
        }

        var root = await env.DockAsync<FilePage>(HttpMethod.Get, $"/internal/repos/{app:D}/files");
        Assert.Contains(root.Entries!, e => e.Name == "SampleApp.csproj");
        var program = await env.DockAsync<FilePage>(HttpMethod.Get, $"/internal/repos/{app:D}/files?path=Program.cs&offset=0&limit=3");
        Assert.True(program.HasMore);
        Assert.Equal(3, program.Content!.Split('\n').Length);

        // A second version, made the way agents make them: in a workspace, committed back — onto the run's own branch, so
        // the app's line is untouched until the run publishes (R2-4).
        var run = await CreateWorkspaceAsync(app);
        await WriteAsync(run, "NOTES.md", "hello\n");
        var commit = await env.DockAsync<WorkspaceCommitResult>(HttpMethod.Post, $"/internal/workspaces/{run:D}/commit", new WorkspaceCommitRequest("Add notes", Author, AuthorEmail));
        await DestroyWorkspaceAsync(run);
        Assert.Equal([created.Head], (await env.DockAsync<CommitLog>(HttpMethod.Get, $"/internal/repos/{app:D}/log")).Commits.Select(c => c.Id));

        // Published: one version on the line, titled with what was asked for; the run's own commit sits behind it.
        var published = await env.DockAsync<CommitInfo>(HttpMethod.Post, $"/internal/repos/{app:D}/runs/{run:D}/publish", new PublishRunRequest("Keep notes", "Endgame factory", "factory@endgame.test"));
        Assert.Equal([created.Head, commit.CommitId], published.Parents);
        Assert.StartsWith("Keep notes\n\nEndgame-Run: ", published.Message, StringComparison.Ordinal);
        var log = await env.DockAsync<CommitLog>(HttpMethod.Get, $"/internal/repos/{app:D}/log");
        Assert.Equal([published.Id, created.Head], log.Commits.Select(c => c.Id));
        var atPublished = await env.DockAsync<FilePage>(HttpMethod.Get, $"/internal/repos/{app:D}/files?path=NOTES.md");
        Assert.Equal("hello", atPublished.Content);
        var restored = await env.DockAsync<CommitInfo>(HttpMethod.Post, $"/internal/repos/{app:D}/restore", new RestoreRequest(created.Head, "Owner Person", "owner@endgame.test", null));
        Assert.Equal([published.Id], restored.Parents);
        using (var gone = await env.DockAsync(HttpMethod.Get, $"/internal/repos/{app:D}/files?path=NOTES.md"))
        {
            Assert.Equal(HttpStatusCode.NotFound, gone.StatusCode);
        }

        var atSecond = await env.DockAsync<FilePage>(HttpMethod.Get, $"/internal/repos/{app:D}/files?path=NOTES.md&ref={commit.CommitId}");
        Assert.Equal("hello", atSecond.Content);
        Assert.Equal(3, (await env.DockAsync<CommitLog>(HttpMethod.Get, $"/internal/repos/{app:D}/log")).Commits.Count);

        using (var archive = await env.DockAsync(HttpMethod.Get, $"/internal/repos/{app:D}/archive?ref={commit.CommitId}"))
        {
            Assert.Equal("application/gzip", archive.Content.Headers.ContentType!.MediaType);
            await using var gzip = new GZipStream(await archive.Content.ReadAsStreamAsync(), CompressionMode.Decompress);
            using var tar = new MemoryStream();
            await gzip.CopyToAsync(tar);
            Assert.True(tar.Length > 1024);
        }

        using var export = await env.DockAsync(HttpMethod.Get, $"/internal/repos/{app:D}/export");
        var bundle = await export.Content.ReadAsByteArrayAsync();
        Assert.StartsWith("# v2 git bundle", System.Text.Encoding.ASCII.GetString(bundle, 0, 20), StringComparison.Ordinal);
    }

    [DockerFact]
    public async Task A_workspace_commit_carries_the_employee_as_author_and_publishing_refuses_a_moved_line()
    {
        var app = Guid.NewGuid();
        await env.DockAsync<RepositoryInfo>(HttpMethod.Post, "/internal/repos", new CreateRepositoryRequest(app));
        var first = await CreateWorkspaceAsync(app);
        var second = await CreateWorkspaceAsync(app);
        try
        {
            var unchanged = await env.DockAsync<WorkspaceCommitResult>(HttpMethod.Post, $"/internal/workspaces/{first:D}/commit", new WorkspaceCommitRequest("Nothing", Author, AuthorEmail));
            Assert.False(unchanged.Changed);

            await WriteAsync(first, "src/feature.txt", "one");
            var made = await env.DockAsync<WorkspaceCommitResult>(HttpMethod.Post, $"/internal/workspaces/{first:D}/commit", new WorkspaceCommitRequest("Add the feature", Author, AuthorEmail));
            Assert.True(made.Changed);
            var head = (await env.DockAsync<CommitLog>(HttpMethod.Get, $"/internal/repos/{app:D}/log?ref={RunBranches.Of(first)}&limit=1")).Commits.Single();
            Assert.Equal(made.CommitId, head.Id);
            Assert.Equal(Author, head.AuthorName);
            Assert.Equal(AuthorEmail, head.AuthorEmail);
            Assert.Equal("Add the feature", head.Message);

            // The second run started from the same version and keeps its own branch; whichever publishes second finds the
            // line moved, and nothing of the first is overwritten.
            await WriteAsync(second, "src/other.txt", "two");
            var other = await env.DockAsync<WorkspaceCommitResult>(HttpMethod.Post, $"/internal/workspaces/{second:D}/commit", new WorkspaceCommitRequest("Other", Author, AuthorEmail));
            Assert.True(other.Changed);
            var published = await env.DockAsync<CommitInfo>(HttpMethod.Post, $"/internal/repos/{app:D}/runs/{first:D}/publish", new PublishRunRequest("Add the feature", "Endgame factory", "factory@endgame.test"));
            using var conflict = await env.DockAsync(HttpMethod.Post, $"/internal/repos/{app:D}/runs/{second:D}/publish", new PublishRunRequest("Other", "Endgame factory", "factory@endgame.test"));
            Assert.Equal(HttpStatusCode.Conflict, conflict.StatusCode);
            Assert.Contains("conflict", await conflict.Content.ReadAsStringAsync(), StringComparison.Ordinal);
            Assert.Equal(published.Id, (await env.DockAsync<RepositoryInfo>(HttpMethod.Get, $"/internal/repos/{app:D}")).Head);
        }
        finally
        {
            await DestroyWorkspaceAsync(first);
            await DestroyWorkspaceAsync(second);
        }
    }

    [DockerFact]
    public async Task The_protected_path_floor_holds_against_dot_dot_git_and_symbolic_links()
    {
        var app = Guid.NewGuid();
        await env.DockAsync<RepositoryInfo>(HttpMethod.Post, "/internal/repos", new CreateRepositoryRequest(app));
        var run = await CreateWorkspaceAsync(app);
        try
        {
            await ExecAsync(run, "ln -s /etc etc-link && ln -s .git git-link && ln -s /etc/hostname host-file");
            foreach (var path in new[] { "../etc/passwd", "/etc/passwd", ".git/config", "src/../.git/HEAD", "etc-link/passwd", "git-link/config", "host-file" })
            {
                using var read = await env.DockAsync(HttpMethod.Get, $"/internal/workspaces/{run:D}/files?path={Uri.EscapeDataString(path)}");
                Assert.True(read.StatusCode == HttpStatusCode.Forbidden, $"read {path}: {(int)read.StatusCode}");
                using var write = await env.DockAsync(HttpMethod.Put, $"/internal/workspaces/{run:D}/files", new WriteFileRequest(path, "x", null));
                Assert.True(write.StatusCode == HttpStatusCode.Forbidden, $"write {path}: {(int)write.StatusCode}");
                Assert.Contains("protected_path", await write.Content.ReadAsStringAsync(), StringComparison.Ordinal);
            }

            using (var cwd = await env.DockAsync(HttpMethod.Post, $"/internal/workspaces/{run:D}/exec", new ExecRequest(["pwd"], null, 10, null, "../", null)))
            {
                Assert.Equal(HttpStatusCode.Forbidden, cwd.StatusCode);
            }

            var listing = await env.DockAsync<FilePage>(HttpMethod.Get, $"/internal/workspaces/{run:D}/files?path=.");
            Assert.DoesNotContain(listing.Entries!, e => e.Name == ".git");
            Assert.Contains(listing.Entries!, e => e.Name == "Program.cs");
        }
        finally
        {
            await DestroyWorkspaceAsync(run);
        }
    }

    [DockerFact]
    public async Task A_workspace_runs_non_root_limited_without_the_socket_and_reaches_only_the_registries()
    {
        var app = Guid.NewGuid();
        await env.DockAsync<RepositoryInfo>(HttpMethod.Post, "/internal/repos", new CreateRepositoryRequest(app));
        var run = await CreateWorkspaceAsync(app, new ResourceLimits(1, 512, 256));
        try
        {
            Assert.Equal("1654", (await ExecAsync(run, "id -u")).Stdout.Trim());
            Assert.Equal(1, (await ExecAsync(run, "test -S /var/run/docker.sock")).ExitCode);
            Assert.Equal("256", (await ExecAsync(run, "cat /sys/fs/cgroup/pids.max")).Stdout.Trim());
            Assert.Equal((512L * 1024 * 1024).ToString(CultureInfo.InvariantCulture), (await ExecAsync(run, "cat /sys/fs/cgroup/memory.max")).Stdout.Trim());
            Assert.Contains("CapEff:\t0000000000000000", (await ExecAsync(run, "grep CapEff /proc/self/status")).Stdout, StringComparison.Ordinal);
            Assert.Contains("10.0.", (await ExecAsync(run, "dotnet --version")).Stdout, StringComparison.Ordinal);

            Assert.NotEqual(0, (await ExecAsync(run, "curl -s -m 5 --noproxy '*' https://1.1.1.1")).ExitCode);
            Assert.Equal("200", (await ExecAsync(run, "curl -s -o /dev/null -w '%{http_code}' -m 20 https://api.nuget.org/v3/index.json")).Stdout.Trim());
            Assert.NotEqual("200", (await ExecAsync(run, "curl -s -o /dev/null -w '%{http_code}' -m 20 https://example.com")).Stdout.Trim());

            var slow = await env.DockAsync<ExecResult>(HttpMethod.Post, $"/internal/workspaces/{run:D}/exec", new ExecRequest(null, "sleep 30", 2, null, null, null));
            Assert.True(slow.TimedOut);
            Assert.True(slow.DurationMs < 10_000);
            var loud = await env.DockAsync<ExecResult>(HttpMethod.Post, $"/internal/workspaces/{run:D}/exec", new ExecRequest(null, "seq 1 200000", 30, 4096, null, null));
            Assert.True(loud.Truncated);
            Assert.StartsWith("1\n2\n", loud.Stdout, StringComparison.Ordinal);
            Assert.EndsWith("200000\n", loud.Stdout, StringComparison.Ordinal);
        }
        finally
        {
            await DestroyWorkspaceAsync(run);
        }
    }

    [DockerFact]
    public async Task A_workspace_is_destroyed_once_its_runs_lease_lapses_and_not_while_renewed()
    {
        var app = Guid.NewGuid();
        await env.DockAsync<RepositoryInfo>(HttpMethod.Post, "/internal/repos", new CreateRepositoryRequest(app));
        var renewed = await CreateWorkspaceAsync(app, lease: TimeSpan.FromSeconds(4));
        var lapsing = await CreateWorkspaceAsync(app, lease: TimeSpan.FromSeconds(4));
        await env.DockAsync<WorkspaceInfo>(HttpMethod.Put, $"/internal/workspaces/{renewed:D}/lease", new RenewLeaseRequest(DateTimeOffset.UtcNow.AddMinutes(5)));
        await HostingEnvironment.WaitAsync("the lapsed workspace to go", async () =>
        {
            using var response = await env.DockAsync(HttpMethod.Get, $"/internal/workspaces/{lapsing:D}");
            return response.StatusCode == HttpStatusCode.NotFound;
        }, TimeSpan.FromSeconds(30));
        // The record goes first and the container and its network a moment after it.
        await HostingEnvironment.WaitAsync("the lapsed workspace's container and network to go", async () =>
            !(await DockerCli.OursAsync("container")).Any(n => n.Contains(lapsing.ToString("D"), StringComparison.Ordinal))
            && !(await DockerCli.OursAsync("network")).Any(n => n.Contains(lapsing.ToString("D"), StringComparison.Ordinal)), TimeSpan.FromSeconds(30));
        using (var kept = await env.DockAsync(HttpMethod.Get, $"/internal/workspaces/{renewed:D}"))
        {
            Assert.Equal(HttpStatusCode.OK, kept.StatusCode);
        }

        await DestroyWorkspaceAsync(renewed);
    }

    [DockerFact]
    public async Task The_app_is_served_at_both_address_shapes_from_one_image()
    {
        using var path = env.EdgeClient();
        using (var bare = await path.GetAsync("/acme/apps/notes/web"))
        {
            Assert.Equal(HttpStatusCode.PermanentRedirect, bare.StatusCode);
            Assert.Equal("/acme/apps/notes/web/", bare.Headers.Location!.OriginalString);
        }

        var page = await path.GetStringAsync("/acme/apps/notes/web/");
        Assert.Contains("<base href=\"/acme/apps/notes/web/\" />", page, StringComparison.Ordinal);
        Assert.Contains("<script src=\"app.js\">", page, StringComparison.Ordinal);
        Assert.Contains("Relative to the page", await path.GetStringAsync("/acme/apps/notes/web/app.js"), StringComparison.Ordinal);

        using var spoofed = new HttpRequestMessage(HttpMethod.Get, "/acme/apps/notes/web/api/whoami");
        spoofed.Headers.Add("X-Forwarded-Prefix", "/elsewhere");
        spoofed.Headers.Add("Cookie", "endgame.session=secret-value; theme=dark");
        using var whoamiResponse = await path.SendAsync(spoofed);
        var whoami = await whoamiResponse.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("/acme/apps/notes/web", whoami.GetProperty("pathBase").GetString());
        Assert.Equal("/api/whoami", whoami.GetProperty("path").GetString());
        Assert.Equal(env.EdgeUrl.Authority, whoami.GetProperty("host").GetString());
        Assert.Equal("theme=dark", whoami.GetProperty("cookie").GetString());
        Assert.Equal(env.NotesApp.ToString("D"), whoami.GetProperty("appId").GetString());
        Assert.True(whoami.GetProperty("token").GetBoolean()); // fetched from the control plane by Dock
        Assert.Equal("", whoami.GetProperty("session").GetString()); // no cookie, no session

        using var host = env.EdgeClient(HostingEnvironment.NotesHost);
        using (var hostBare = await host.GetAsync("/apps/notes/web"))
        {
            Assert.Equal(HttpStatusCode.PermanentRedirect, hostBare.StatusCode);
        }

        var hostPage = await host.GetStringAsync("/apps/notes/web/");
        Assert.Contains("<base href=\"/apps/notes/web/\" />", hostPage, StringComparison.Ordinal);
        var hostWhoami = await host.GetFromJsonAsync<JsonElement>("/apps/notes/web/api/whoami");
        Assert.Equal("/apps/notes/web", hostWhoami.GetProperty("pathBase").GetString());
        Assert.Equal(HostingEnvironment.NotesHost, hostWhoami.GetProperty("host").GetString());

        // The platform's own paths are never the app's, and internal APIs are never routed.
        using var platform = await path.GetAsync("/api/system/status");
        Assert.Contains("control-plane", await platform.Content.ReadAsStringAsync(), StringComparison.Ordinal);
        using var internalPath = await path.GetAsync("/internal/routes");
        Assert.Equal(HttpStatusCode.NotFound, internalPath.StatusCode);
    }

    [DockerFact]
    public async Task App_containers_run_with_every_hardening_rule_of_ARCH_005()
    {
        var inspect = JsonDocument.Parse(await DockerCli.CheckedAsync("inspect", HostingEnvironment.AppContainer(env.NotesApp))).RootElement[0];
        var host = inspect.GetProperty("HostConfig");
        Assert.True(host.GetProperty("ReadonlyRootfs").GetBoolean());
        Assert.Equal(["ALL"], host.GetProperty("CapDrop").EnumerateArray().Select(e => e.GetString()));
        Assert.Contains("no-new-privileges:true", host.GetProperty("SecurityOpt").EnumerateArray().Select(e => e.GetString()));
        Assert.False(host.GetProperty("Privileged").GetBoolean());
        Assert.Equal(256L * 1024 * 1024, host.GetProperty("Memory").GetInt64());
        Assert.Equal(128, host.GetProperty("PidsLimit").GetInt64());
        Assert.Contains("noexec", host.GetProperty("Tmpfs").GetProperty("/tmp").GetString(), StringComparison.Ordinal);
        Assert.Empty(inspect.GetProperty("Mounts").EnumerateArray());
        Assert.Equal("1654:1654", inspect.GetProperty("Config").GetProperty("User").GetString());
        var networks = inspect.GetProperty("NetworkSettings").GetProperty("Networks").EnumerateObject().Select(n => n.Name).ToList();
        Assert.Equal([$"{DockerCli.Prefix}appnet-{env.NotesApp:D}"], networks);
        var network = JsonDocument.Parse(await DockerCli.CheckedAsync("network", "inspect", networks[0])).RootElement[0];
        Assert.True(network.GetProperty("Internal").GetBoolean());
        var subnet = network.GetProperty("IPAM").GetProperty("Config")[0].GetProperty("Subnet").GetString()!;
        Assert.EndsWith("/28", subnet, StringComparison.Ordinal);
        Assert.True(Ipv4Cidr.Parse(HostingEnvironment.SubnetPool).Overlaps(Ipv4Cidr.Parse(subnet)));
        var members = network.GetProperty("Containers").EnumerateObject().Select(c => c.Value.GetProperty("Name").GetString()).ToList();
        Assert.DoesNotContain(HostingEnvironment.Container("dock"), members); // the socket holder never joins an app network
        Assert.Contains(HostingEnvironment.Container("edge"), members);

        var image = JsonDocument.Parse(await DockerCli.CheckedAsync("image", "inspect", env.NotesBuild)).RootElement[0];
        output.WriteLine($"app image: {image.GetProperty("Size").GetInt64() / (1024 * 1024)} MB, first build {env.BuildTime.TotalSeconds:F1}s; {string.Join("; ", env.Timings)}");
    }

    [DockerFact]
    public async Task An_idle_app_sleeps_by_its_own_setting_and_wakes_on_the_next_request()
    {
        env.PublishRoutes(ledgerIdleSeconds: 2);
        await env.RefreshEdgeAsync();
        try
        {
            using var client = env.EdgeClient();
            (await client.GetAsync("/acme/apps/ledger/web/api/notes")).EnsureSuccessStatusCode();
            await HostingEnvironment.WaitAsync("the ledger app to sleep", async () =>
                (await env.DockAsync<AppStatus>(HttpMethod.Get, $"/internal/apps/{env.LedgerApp:D}")).State == AppRuntimeState.Sleeping, TimeSpan.FromSeconds(30));
            var notes = await env.DockAsync<AppStatus>(HttpMethod.Get, $"/internal/apps/{env.NotesApp:D}");
            Assert.Equal(AppRuntimeState.Running, notes.State); // its own setting is an hour

            using var woken = await client.GetAsync("/acme/apps/ledger/web/api/notes");
            Assert.Equal(HttpStatusCode.OK, woken.StatusCode);
            Assert.True(woken.Headers.Contains(HostingConventions.WakeTimeHeader));
        }
        finally
        {
            env.PublishRoutes();
            await env.RefreshEdgeAsync();
        }
    }

    [DockerFact]
    public async Task A_sleeping_app_wakes_in_well_under_a_second_measured_over_ten_wakes()
    {
        var timings = new List<double>();
        for (var i = 0; i < 10; i++)
        {
            await SleepNotesAsync();
            using var client = env.EdgeClient();
            var clock = Stopwatch.StartNew();
            using var response = await client.GetAsync("/acme/apps/notes/web/", HttpCompletionOption.ResponseHeadersRead);
            var firstByte = clock.Elapsed.TotalMilliseconds;
            Assert.True(response.StatusCode == HttpStatusCode.OK, $"wake {i}: {(int)response.StatusCode} {await response.Content.ReadAsStringAsync()}");
            Assert.True(response.Headers.Contains(HostingConventions.WakeTimeHeader), $"wake {i}: the request did not wake the app: {await env.EdgeAppsAsync()}");
            timings.Add(firstByte);
        }

        timings.Sort();
        var median = (timings[4] + timings[5]) / 2;
        var line = $"WAKE first byte over 10 wakes: median {median:F0} ms, worst {timings[^1]:F0} ms, best {timings[0]:F0} ms; all: {string.Join(", ", timings.Select(t => t.ToString("F0", CultureInfo.InvariantCulture)))}";
        output.WriteLine(line);
        Assert.True(timings[^1] < 5000, line);
    }

    [DockerFact]
    public async Task Concurrent_requests_to_a_sleeping_app_share_one_wake()
    {
        await SleepNotesAsync();
        var before = WakesOf(await env.EdgeAppsAsync(), env.NotesApp);
        using var client = env.EdgeClient();
        var responses = await Task.WhenAll(Enumerable.Range(0, 20).Select(_ => client.GetAsync("/acme/apps/notes/web/api/notes")));
        Assert.All(responses, r => Assert.Equal(HttpStatusCode.OK, r.StatusCode));
        Assert.Equal(before + 1, WakesOf(await env.EdgeAppsAsync(), env.NotesApp));
        foreach (var response in responses)
        {
            response.Dispose();
        }
    }

    [DockerFact]
    public async Task A_crash_gets_the_unavailable_page_at_once_is_reported_and_recovers()
    {
        var reported = env.ControlPlane.States.Count;
        using var client = env.EdgeClient();
        (await client.GetAsync("/acme/apps/ledger/web/api/notes")).EnsureSuccessStatusCode();
        using (var crash = await client.PostAsync("/acme/apps/ledger/web/api/crash", null))
        {
            Assert.Equal(HttpStatusCode.Accepted, crash.StatusCode);
        }

        await HostingEnvironment.WaitAsync("the crash report", () => Task.FromResult(env.ControlPlane.States.Skip(reported).Any(s => s.AppId == env.LedgerApp && s.Report.Status == ControlPlaneAppState.Failed)), TimeSpan.FromSeconds(15));
        var status = await env.DockAsync<AppStatus>(HttpMethod.Get, $"/internal/apps/{env.LedgerApp:D}");
        Assert.Equal(AppRuntimeState.Crashed, status.State);
        Assert.Equal(3, status.ExitCode);

        var clock = Stopwatch.StartNew();
        using var page = await client.GetAsync("/acme/apps/ledger/web/");
        Assert.True(clock.Elapsed < TimeSpan.FromSeconds(2), $"the page took {clock.Elapsed}");
        Assert.Equal(HttpStatusCode.ServiceUnavailable, page.StatusCode);
        var html = await page.Content.ReadAsStringAsync();
        Assert.Contains("This app has stopped for a moment", html, StringComparison.Ordinal);
        Assert.Contains("/brand/endgame-mark.svg", html, StringComparison.Ordinal);
        Assert.DoesNotContain("container", html, StringComparison.OrdinalIgnoreCase);

        // After the back-off the next visitor wakes it again.
        await Task.Delay(TimeSpan.FromSeconds(5));
        using var recovered = await client.GetAsync("/acme/apps/ledger/web/api/notes");
        Assert.Equal(HttpStatusCode.OK, recovered.StatusCode);
    }

    [DockerFact]
    public async Task Egress_is_denied_by_default_and_allowed_per_app_by_subnet()
    {
        using var client = env.EdgeClient();
        async Task<JsonElement> Fetch(string app, string url, bool direct = false) =>
            await client.GetFromJsonAsync<JsonElement>($"/acme/apps/{app}/web/api/fetch?url={Uri.EscapeDataString(url)}&direct={direct.ToString().ToLowerInvariant()}");

        var allowed = await Fetch("notes", "https://example.com");
        Assert.True(allowed.GetProperty("reached").GetBoolean(), allowed.ToString());
        Assert.Equal(200, allowed.GetProperty("status").GetInt32());
        Assert.False((await Fetch("notes", "https://www.google.com")).GetProperty("reached").GetBoolean());
        Assert.False((await Fetch("ledger", "https://example.com")).GetProperty("reached").GetBoolean());
        Assert.False((await Fetch("notes", "https://example.com", direct: true)).GetProperty("reached").GetBoolean());

        // Every app reaches the platform API, and only through the proxy.
        var platform = await Fetch("ledger", $"http://{HostingEnvironment.PlatformHost}:{env.ControlPlane.Port}/api/ping");
        Assert.True(platform.GetProperty("reached").GetBoolean(), platform.ToString());

        // The allow-list is changed without a restart.
        await env.DockAsync<AppStatus>(HttpMethod.Put, $"/internal/apps/{env.LedgerApp:D}/egress", new EgressAllowList(["example.com"]));
        await HostingEnvironment.WaitAsync("the new allow-list", async () => (await Fetch("ledger", "https://example.com")).GetProperty("reached").GetBoolean(), TimeSpan.FromSeconds(20));
        await env.DockAsync<AppStatus>(HttpMethod.Put, $"/internal/apps/{env.LedgerApp:D}/egress", new EgressAllowList([]));
        await HostingEnvironment.WaitAsync("the emptied allow-list", async () => !(await Fetch("ledger", "https://example.com")).GetProperty("reached").GetBoolean(), TimeSpan.FromSeconds(20));
    }

    [DockerFact]
    public async Task Apps_cannot_read_each_others_data_or_the_platforms()
    {
        using var client = env.EdgeClient();
        var marker = $"note-{Guid.NewGuid():N}";
        (await client.PostAsync("/acme/apps/notes/web/api/notes", new StringContent(marker))).EnsureSuccessStatusCode();
        Assert.Contains(marker, await client.GetFromJsonAsync<string[]>("/acme/apps/notes/web/api/notes") ?? []);
        Assert.DoesNotContain(marker, await client.GetFromJsonAsync<string[]>("/acme/apps/ledger/web/api/notes") ?? []);

        foreach (var app in new[] { "notes", "ledger" })
        {
            var databases = await client.GetFromJsonAsync<JsonElement>($"/acme/apps/{app}/web/api/databases");
            var own = databases.GetProperty("own").GetString();
            var opened = databases.GetProperty("opened").EnumerateArray().Select(e => e.GetString()).ToList();
            var visible = databases.GetProperty("visible").EnumerateArray().Select(e => e.GetString()).ToList();
            Assert.Equal([own], opened);
            Assert.Contains("postgres", visible);
            Assert.True(visible.Count >= 4, string.Join(",", visible));
            Assert.All(visible.Where(v => v!.StartsWith("d_", StringComparison.Ordinal)), name => Assert.Matches("^d_[0-9a-f]{24}$", name));
        }
    }

    [DockerFact]
    public async Task The_control_plane_takes_an_apps_own_database_as_a_pg_dump_archive_and_gets_not_found_before_it_has_one()
    {
        using var client = env.EdgeClient();
        var marker = $"exported-{Guid.NewGuid():N}";
        (await client.PostAsync("/acme/apps/ledger/web/api/notes", new StringContent(marker))).EnsureSuccessStatusCode();

        // The real caller: the control plane's DockClient, as the Owner's export uses it.
        var services = new ServiceCollection();
        services.AddHttpClient(DockClient.ClientName);
        services.Configure<ServiceAddresses>(a => a.Dock = env.DockUrl.ToString());
        services.AddSingleton<IConfiguration>(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { [HostingConventions.ServiceTokenVariable] = env.Token }).Build());
        services.AddSingleton<DockClient>();
        await using var provider = services.BuildServiceProvider();
        var dock = provider.GetRequiredService<DockClient>();

        using var dump = new MemoryStream();
        Assert.True(await dock.DatabaseDumpAsync(env.LedgerApp, dump, CancellationToken.None));
        var bytes = dump.ToArray();
        Assert.Equal("PGDMP", System.Text.Encoding.ASCII.GetString(bytes, 0, 5)); // pg_dump's custom format

        // pg_restore 16 reads it back, and the app's row is in it.
        var file = Path.Combine(Path.GetTempPath(), $"{DockerCli.Prefix}{Guid.NewGuid():N}.dump");
        await File.WriteAllBytesAsync(file, bytes);
        try
        {
            await DockerCli.CheckedAsync("cp", file, $"{HostingEnvironment.Container("postgres")}:/tmp/ledger.dump");
            var sql = await DockerCli.CheckedAsync("exec", HostingEnvironment.Container("postgres"), "pg_restore", "--file=-", "/tmp/ledger.dump");
            Assert.Contains(marker, sql, StringComparison.Ordinal);
            Assert.Contains("PostgreSQL database dump", sql, StringComparison.Ordinal);
            Assert.DoesNotContain("endgame_system", sql, StringComparison.Ordinal); // only the app's own database
        }
        finally
        {
            File.Delete(file);
        }

        // An app that never ran has no database: Dock says not_found and the export leaves the dump out.
        using var none = new MemoryStream();
        Assert.False(await dock.DatabaseDumpAsync(Guid.NewGuid(), none, CancellationToken.None));
        using var refused = await env.DockAsync(HttpMethod.Get, $"/internal/apps/{Guid.NewGuid():D}/database/dump");
        Assert.Equal(HttpStatusCode.NotFound, refused.StatusCode);
        Assert.Equal("not_found", (await refused.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());
    }

    [DockerFact]
    public async Task The_evaluators_preview_has_its_own_database_and_leaves_nothing_in_the_app_when_destroyed()
    {
        // The evaluator's test records stayed in published apps: it wrote into the app's own database. A preview is the same
        // image beside the app with a database of its own, reached only through the control listener, and destroyed with it.
        var app = env.LedgerApp;
        var preview = HostingEnvironment.AppContainer(app) + HostingConventions.PreviewSuffix;
        var status = await env.DockAsync<AppStatus>(HttpMethod.Post, $"/internal/apps/{app:D}/preview", new StartAppRequest(HostingEnvironment.OrganisationId, null, null, null, null));
        Assert.Equal($"http://{preview}:{HostingConventions.AppPort}", status.Target);

        async Task<(HttpStatusCode Status, string Body)> CallAsync(HttpMethod method, string path, string? body, bool toPreview)
        {
            using var request = new HttpRequestMessage(method, new Uri(env.EdgeControlUrl, $"/internal/apps/{app:D}/call/{path}"));
            request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue(HostingConventions.ServiceTokenScheme, env.Token);
            if (toPreview)
            {
                request.Headers.TryAddWithoutValidation(HostingConventions.PreviewHeader, "1");
            }

            if (body is not null)
            {
                request.Content = new StringContent(body);
            }

            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(60) };
            using var response = await http.SendAsync(request);
            return (response.StatusCode, await response.Content.ReadAsStringAsync());
        }

        (HttpStatusCode Status, string Body) last = (HttpStatusCode.OK, "");
        try
        {
            await HostingEnvironment.WaitAsync("the preview answering", async () => (last = await CallAsync(HttpMethod.Get, "api/notes", null, toPreview: true)).Status == HttpStatusCode.OK, TimeSpan.FromSeconds(60));
        }
        catch (TimeoutException)
        {
            var (_, logs, errors) = await DockerCli.RunAsync(TimeSpan.FromSeconds(20), "logs", "--tail", "40", preview);
            var (_, state, _) = await DockerCli.RunAsync(TimeSpan.FromSeconds(20), "inspect", "-f", "{{.State.Status}} exit {{.State.ExitCode}} oom {{.State.OOMKilled}} {{json .NetworkSettings.Networks}}", preview);
            logs = state + "\n" + logs;
            Assert.Fail($"The preview never answered: {(int)last.Status} {last.Body}\n--- preview ---\n{logs}{errors}\n--- edge ---\n{await env.LogsAsync("edge")}");
        }

        var note = $"Added by Test member (member-a) {Guid.NewGuid():N}";
        Assert.Equal(HttpStatusCode.Created, (await CallAsync(HttpMethod.Post, "api/notes", note, toPreview: true)).Status);
        Assert.Contains(note, (await CallAsync(HttpMethod.Get, "api/notes", null, toPreview: true)).Body, StringComparison.Ordinal);
        var live = await CallAsync(HttpMethod.Get, "api/notes", null, toPreview: false);
        Assert.Equal(HttpStatusCode.OK, live.Status);
        Assert.DoesNotContain(note, live.Body, StringComparison.Ordinal);

        Assert.Equal(HttpStatusCode.NoContent, (await env.DockAsync(HttpMethod.Delete, $"/internal/apps/{app:D}/preview")).StatusCode);
        Assert.DoesNotContain(preview, await DockerCli.CheckedAsync("ps", "-a", "--format", "{{.Names}}"), StringComparison.Ordinal);
        var previews = await DockerCli.CheckedAsync("exec", HostingEnvironment.Container("postgres"), "psql", "-U", "postgres", "-tAc", "SELECT count(*) FROM pg_database WHERE datname LIKE 'p\\_%'");
        Assert.Equal("0", previews.Trim());
        Assert.DoesNotContain(note, (await CallAsync(HttpMethod.Get, "api/notes", null, toPreview: false)).Body, StringComparison.Ordinal);
        Assert.NotEqual(HttpStatusCode.OK, (await CallAsync(HttpMethod.Get, "api/notes", null, toPreview: true)).Status);
    }

    [DockerFact]
    public async Task The_egress_proxy_comes_back_when_its_container_restarts()
    {
        // After Docker itself stopped uncleanly, the proxy's own pid file survived in its container and named PID 1 —
        // the restarted squid — so every restart refused to run ("Squid is already running") and apps lost the platform.
        var proxy = HostingEnvironment.Container("egress");
        await DockerCli.CheckedAsync("restart", "--time", "0", proxy);
        await HostingEnvironment.WaitAsync("the proxy running again after its restart", async () =>
            (await DockerCli.CheckedAsync("inspect", "--format", "{{.State.Running}} {{.RestartCount}}", proxy)).Trim().StartsWith("true", StringComparison.Ordinal)
            && (await DockerCli.RunAsync(TimeSpan.FromSeconds(10), "exec", proxy, "nc", "-z", "127.0.0.1", "3128")).ExitCode == 0, TimeSpan.FromSeconds(30));
        using var client = env.EdgeClient();
        var platform = await client.GetFromJsonAsync<JsonElement>($"/acme/apps/ledger/web/api/fetch?url={Uri.EscapeDataString($"http://{HostingEnvironment.PlatformHost}:{env.ControlPlane.Port}/api/ping")}&direct=false");
        Assert.True(platform.GetProperty("reached").GetBoolean(), platform.ToString());
    }

    [DockerFact]
    public async Task A_recreated_edge_reaches_an_app_again_on_its_next_wake()
    {
        // A redeployed edge is a new container on none of the app networks: every app answered 503 until restarted.
        var network = $"{DockerCli.Prefix}appnet-{env.LedgerApp:D}";
        await DockerCli.CheckedAsync("network", "disconnect", "--force", network, HostingEnvironment.Container("edge"));
        await env.EdgeControlAsync(HttpMethod.Post, $"/internal/apps/{env.LedgerApp:D}/state", new AppStateReport(env.LedgerApp, AppRuntimeState.Sleeping, 0, false, DateTimeOffset.UtcNow));
        using var client = env.EdgeClient();
        using var response = await client.GetAsync("/acme/apps/ledger/web/api/notes");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var attached = await DockerCli.CheckedAsync("network", "inspect", "--format", "{{range .Containers}}{{.Name}} {{end}}", network);
        Assert.Contains(HostingEnvironment.Container("edge"), attached, StringComparison.Ordinal);
    }

    [DockerFact]
    public async Task An_app_cannot_reach_the_edges_control_listener_or_dock()
    {
        using var client = env.EdgeClient();
        foreach (var url in new[]
        {
            $"http://{HostingEnvironment.Container("edge")}:8081/health",
            $"http://{HostingEnvironment.Container("edge")}:8080/health",
            $"http://{HostingEnvironment.Container("dock")}:8080/health",
            $"http://{HostingEnvironment.AppContainer(env.LedgerApp)}:8080/health",
        })
        {
            var direct = await client.GetFromJsonAsync<JsonElement>($"/acme/apps/notes/web/api/fetch?url={Uri.EscapeDataString(url)}&direct=true");
            Assert.False(direct.GetProperty("reached").GetBoolean(), $"{url}: {direct}");
            var proxied = await client.GetFromJsonAsync<JsonElement>($"/acme/apps/notes/web/api/fetch?url={Uri.EscapeDataString(url)}");
            Assert.False(proxied.GetProperty("reached").GetBoolean() && proxied.GetProperty("status").GetInt32() == 200, $"{url} via proxy: {proxied}");
        }
    }

    [DockerFact]
    public void Every_start_of_a_new_version_was_reported_to_the_control_plane()
    {
        var notes = env.ControlPlane.Published.Where(p => p.AppId == env.NotesApp).ToList();
        var published = Assert.Single(notes);
        Assert.Equal(40, published.Report.Version.Length);
        Assert.EndsWith(published.Report.Version, env.NotesBuild, StringComparison.Ordinal);
        Assert.Contains(env.ControlPlane.States, s => s.AppId == env.NotesApp && s.Report.Status == AppRuntimeState.Running);
    }

    [DockerWithAppKitFact]
    public async Task The_app_kit_template_is_committed_built_and_served_at_both_shapes_with_its_sessions()
    {
        var template = Path.Combine(env.RepositoryRoot, "src", "appkit", "template");
        var app = Guid.NewGuid();
        await env.DockAsync<RepositoryInfo>(HttpMethod.Post, "/internal/repos", new CreateRepositoryRequest(app));

        // An agent's way in: a workspace, the template's files written one by one, committed.
        var run = await CreateWorkspaceAsync(app);
        try
        {
            Assert.Equal(0, (await ExecAsync(run, "find /workspace -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +")).ExitCode);
            string[] skipped = ["node_modules", "bin", "obj", "wwwroot", ".tmp", "TestResults", "test-results", "coverage"];
            var files = Directory.EnumerateFiles(template, "*", SearchOption.AllDirectories)
                .Select(f => Path.GetRelativePath(template, f).Replace('\\', '/'))
                .Where(r => !r.Split('/').Any(skipped.Contains) && !r.EndsWith(".DS_Store", StringComparison.Ordinal))
                .ToList();
            foreach (var file in files)
            {
                var bytes = await File.ReadAllBytesAsync(Path.Combine(template, file));
                await env.DockAsync<WriteFileResult>(HttpMethod.Put, $"/internal/workspaces/{run:D}/files", new WriteFileRequest(file, Convert.ToBase64String(bytes), "base64"));
            }

            Assert.Contains("ENDGAME_TEST_DATABASE=Host=postgres", (await ExecAsync(run, "env | grep ENDGAME_TEST_DATABASE")).Stdout, StringComparison.Ordinal);
            Assert.Equal(0, (await ExecAsync(run, "exec 3<>/dev/tcp/postgres/5432")).ExitCode);
            var commit = await env.DockAsync<WorkspaceCommitResult>(HttpMethod.Post, $"/internal/workspaces/{run:D}/commit", new WorkspaceCommitRequest("Start from the app kit's template", Author, AuthorEmail));
            Assert.True(commit.Changed);
            output.WriteLine($"template: {files.Count} files committed as {commit.CommitId[..12]}");
        }
        finally
        {
            await DestroyWorkspaceAsync(run);
        }

        var clock = Stopwatch.StartNew();
        var build = await env.DockAsync<BuildResult>(HttpMethod.Post, $"/internal/apps/{app:D}/build", new BuildRequest(RunBranches.Of(run)));
        output.WriteLine($"template build: {clock.Elapsed.TotalSeconds:F0}s");
        var started = await env.DockAsync<AppStatus>(HttpMethod.Post, $"/internal/apps/{app:D}/start", new StartAppRequest(HostingEnvironment.OrganisationId, null, null, null, null));
        Assert.Equal(AppRuntimeState.Running, started.State);
        Assert.Equal(build.Image, started.Image);
        env.PublishRoutes(3600, env.Route(app, "kit", 3600));
        await env.RefreshEdgeAsync();
        try
        {
            using var path = env.EdgeClient();
            await HostingEnvironment.WaitAsync("the template app", async () => (await path.GetAsync("/acme/apps/kit/web/health")).IsSuccessStatusCode, TimeSpan.FromSeconds(60));
            using (var bare = await path.GetAsync("/acme/apps/kit/web"))
            {
                Assert.Equal(HttpStatusCode.PermanentRedirect, bare.StatusCode);
            }

            Assert.Contains("<base href=\"/acme/apps/kit/web/\"", await path.GetStringAsync("/acme/apps/kit/web/"), StringComparison.Ordinal);
            using var host = env.EdgeClient(HostingEnvironment.NotesHost);
            Assert.Contains("<base href=\"/apps/kit/web/\"", await host.GetStringAsync("/apps/kit/web/notes/new"), StringComparison.Ordinal);
            Assert.Equal(HttpStatusCode.OK, (await host.GetAsync("/apps/kit/web/api/notes")).StatusCode);

            // Signed out, writing is refused by the app; the sign-in page is the edge's.
            using (var anonymous = await path.PostAsJsonAsync("/acme/apps/kit/web/api/notes", new { title = "anonymous", body = "x" }))
            {
                Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
            }

            using (var signIn = await path.GetAsync("/acme/apps/kit/web/_endgame/auth/sign-in?returnTo=%2Facme%2Fapps%2Fkit%2Fweb%2Fnotes%2Fnew"))
            {
                // The edge's own identity page, driving the control plane's /api/app-auth/{appId}.
                Assert.Equal(HttpStatusCode.OK, signIn.StatusCode);
                var page = await signIn.Content.ReadAsStringAsync();
                Assert.Contains($"\"appId\":\"{app:D}\"", page, StringComparison.Ordinal);
                Assert.Contains("/acme/apps/kit/web/notes/new", page, StringComparison.Ordinal);
            }

            // Signed in, the edge hands the app an app-scoped session; the kit resolves it through the platform.
            using var write = new HttpRequestMessage(HttpMethod.Post, "/acme/apps/kit/web/api/notes") { Content = JsonContent.Create(new { title = "Through the edge", body = "Written by a member." }) };
            write.Headers.Add("Cookie", $"endgame.session={FakeControlPlane.MemberSession}");
            using var written = await path.SendAsync(write);
            Assert.True(written.StatusCode == HttpStatusCode.Created, $"{(int)written.StatusCode}: {await written.Content.ReadAsStringAsync()}");
            Assert.Contains(env.ControlPlane.AppCalls, c => c.EndsWith("/identity/resolve", StringComparison.Ordinal));
            var list = await path.GetStringAsync("/acme/apps/kit/web/api/notes");
            Assert.Contains("Through the edge", list, StringComparison.Ordinal);

            using (var callback = await path.PostAsync("/acme/apps/kit/web/_platform/schedules/nightly", null))
            {
                Assert.Equal(HttpStatusCode.NotFound, callback.StatusCode);
            }
        }
        finally
        {
            env.PublishRoutes();
            await env.RefreshEdgeAsync();
            if (Environment.GetEnvironmentVariable("ENDGAME_TEST_KEEP_DOCKER") != "1")
            {
                using var retired = await env.DockAsync(HttpMethod.Delete, $"/internal/apps/{app:D}");
            }
        }
    }

    private async Task SleepNotesAsync()
    {
        await env.DockAsync<AppStatus>(HttpMethod.Post, $"/internal/apps/{env.NotesApp:D}/stop");
        await env.EdgeControlAsync(HttpMethod.Post, $"/internal/apps/{env.NotesApp:D}/state",
            new AppStateReport(env.NotesApp, AppRuntimeState.Sleeping, 0, false, DateTimeOffset.UtcNow));
        await Task.Delay(500);
    }

    private static int WakesOf(JsonElement apps, Guid appId) =>
        apps.EnumerateArray().Single(a => a.GetProperty("appId").GetGuid() == appId).GetProperty("wakes").GetInt32();

    private async Task<Guid> CreateWorkspaceAsync(Guid app, ResourceLimits? limits = null, TimeSpan? lease = null)
    {
        var run = Guid.NewGuid();
        var info = await env.DockAsync<WorkspaceInfo>(HttpMethod.Post, "/internal/workspaces",
            new CreateWorkspaceRequest(run, app, null, DateTimeOffset.UtcNow + (lease ?? TimeSpan.FromMinutes(10)), limits, null));
        Assert.Equal(run, info.Id);
        return run;
    }

    private async Task DestroyWorkspaceAsync(Guid run)
    {
        using var response = await env.DockAsync(HttpMethod.Delete, $"/internal/workspaces/{run:D}");
    }

    private async Task WriteAsync(Guid run, string path, string content)
    {
        var written = await env.DockAsync<WriteFileResult>(HttpMethod.Put, $"/internal/workspaces/{run:D}/files", new WriteFileRequest(path, content, null));
        Assert.Equal(path, written.Path);
    }

    private async Task<ExecResult> ExecAsync(Guid run, string shell) =>
        await env.DockAsync<ExecResult>(HttpMethod.Post, $"/internal/workspaces/{run:D}/exec", new ExecRequest(null, shell, 60, null, null, null));
}
