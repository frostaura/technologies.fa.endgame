using System.Diagnostics;
using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using Endgame.Ops.Backups;
using Xunit.Abstractions;

namespace Endgame.Ops.Tests.Rehearsal;

/// <summary>
/// The rehearsed restore (spec: "Addresses and hosting" — rehearsed once, end to end): a throwaway
/// stack of its own (compose project <c>test-endgame-ops-rehearsal</c>, its own free ports and
/// subnet pool, never the <c>endgame</c> project), real data created through its Edge and Dock, a
/// backup with <c>make backup</c> to a test-only S3-compatible server in a container, the stack's
/// volumes destroyed, <c>make restore</c>, and every piece of data checked — the secret by
/// decrypting it through the platform API. Every Docker resource is named <c>test-endgame-ops-*</c>
/// and removed afterwards. Set ENDGAME_SKIP_DOCKER_TESTS=1 to skip it on a machine with no Docker.
/// </summary>
[Trait("Category", "Docker")]
public sealed class RehearsalTests(ITestOutputHelper output)
{
    private const string Project = "test-endgame-ops-rehearsal";
    private const string S3Container = "test-endgame-ops-s3";
    private const string S3Network = "test-endgame-ops-s3net";
    private const string S3Image = "versity/versitygw:v1.0.16";
    private const string Bucket = "endgame-rehearsal";
    private const string OwnerEmail = "dev@frostaura.net";
    private const string OperatorEmail = "operator@endgame.localhost";
    private const string Org = "rehearsal";
    private static readonly TimeSpan Long = TimeSpan.FromMinutes(25);

    private readonly string repositoryRoot = FindRepositoryRoot();
    private readonly string serviceToken = "rehearsal_" + Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(16));
    private readonly string s3Access = "rehearsal" + Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(4));
    private readonly string s3Secret = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(20));
    private readonly string secretValue = "rehearsal-" + Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(12));
    private readonly string appPassword = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(12));
    private readonly int edgePort = FreePort();
    private readonly int postgresPort = FreePort();
    private readonly int mailPort = FreePort();
    private readonly int dockPort = FreePort();
    private readonly int opsPort = FreePort();
    private readonly int s3Port = FreePort();
    private readonly List<string> report = [];

    private string EmptyEnvFile => Path.Combine(repositoryRoot, ".tmp", "ops-rehearsal", "empty.env");

    private string Overlay => Path.Combine(AppContext.BaseDirectory, "Rehearsal", "docker-compose.rehearsal.yml");

    private string ComposeCommand => $"docker compose --env-file {EmptyEnvFile} -f docker-compose.yml -f docker-compose.e2e.yml -f {Overlay}";

    [Fact]
    public async Task Backup_then_destroy_then_restore_brings_every_piece_of_data_back()
    {
        if (Environment.GetEnvironmentVariable("ENDGAME_SKIP_DOCKER_TESTS") is "1" or "true")
        {
            output.WriteLine("Skipped: ENDGAME_SKIP_DOCKER_TESTS is set.");
            return;
        }

        Directory.CreateDirectory(Path.GetDirectoryName(EmptyEnvFile)!);
        await File.WriteAllTextAsync(EmptyEnvFile, "");
        await TearDownAsync();
        try
        {
            await RehearseAsync();
        }
        finally
        {
            foreach (var line in report)
            {
                output.WriteLine(line);
                Console.WriteLine($"[rehearsal] {line}");
            }

            await TearDownAsync();
            Directory.Delete(Path.GetDirectoryName(EmptyEnvFile)!, recursive: true);
        }
    }

    private async Task RehearseAsync()
    {
        // The test-only bucket server, on its own network, outside the stack that will be destroyed.
        await Docker("network", "create", "--label", "endgame.test=ops", S3Network);
        await Docker("run", "-d", "--name", S3Container, "--network", S3Network, "--network-alias", "s3", "-p", $"127.0.0.1:{s3Port}:7070",
            "-e", $"ROOT_ACCESS_KEY_ID={s3Access}", "-e", $"ROOT_SECRET_ACCESS_KEY={s3Secret}", S3Image, "--quiet", "posix", "/tmp");
        var s3 = new S3Client(new HttpClient(), new BackupOptions
        {
            S3Endpoint = $"http://127.0.0.1:{s3Port}",
            S3Bucket = Bucket,
            S3AccessKeyId = s3Access,
            S3SecretAccessKey = s3Secret,
            S3Region = "us-east-1",
        }, TimeProvider.System);
        await WaitAsync("the S3 server", async () => await CreateBucketAsync() is HttpStatusCode.OK, TimeSpan.FromSeconds(30));

        var watch = Stopwatch.StartNew();
        await Compose(Long, "up", "-d", "--build", "--wait");
        report.Add($"stack {Project} built and up in {watch.Elapsed.TotalSeconds:0} s (edge :{edgePort}, ops :{opsPort})");

        // --- Data: an organisation, an app with its repository, a secret, ledger entries, an app database.
        using var owner = await SignInAsync(OwnerEmail, "Rehearsal owner");
        using var operatorClient = await SignInAsync(OperatorEmail, "Rehearsal operator");
        var created = await owner.PostAsJsonAsync("/api/organisations", new { name = "Rehearsal", slug = Org });
        if (created.StatusCode == HttpStatusCode.Forbidden)
        {
            created = await operatorClient.PostAsJsonAsync("/api/organisations", new { name = "Rehearsal", slug = Org, ownerEmail = OwnerEmail });
        }

        await Expect(created, HttpStatusCode.Created);
        await Expect(await owner.PostAsJsonAsync("/api/divisions", new { parent = Org, name = "Operations", slug = "ops" }), HttpStatusCode.Created);
        await Expect(await owner.PostAsJsonAsync("/api/projects", new { parent = $"{Org}/ops", name = "Drill", slug = "drill" }), HttpStatusCode.Created);
        var app = await Expect(await owner.PostAsJsonAsync("/api/apps", new { parent = $"{Org}/ops/drill", name = "Notes", slug = "notes" }), HttpStatusCode.Created);
        var appId = (string)app["id"]!;

        using var dock = new HttpClient { BaseAddress = new Uri($"http://127.0.0.1:{dockPort}") };
        dock.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", serviceToken);
        var repository = await Expect(await dock.PostAsJsonAsync("/internal/repos", new { appId }), HttpStatusCode.Created);
        var head = (string)repository["head"]!;

        await Expect(await owner.PutAsJsonAsync("/api/secrets", new { scope = Org, name = "REHEARSAL_SECRET", value = secretValue }), HttpStatusCode.OK);
        await Expect(await operatorClient.PostAsJsonAsync("/api/credits/top-ups", new { organisation = Org, credits = 42, note = "rehearsal top-up" }), HttpStatusCode.OK);
        await Expect(await operatorClient.PostAsJsonAsync("/api/credits/top-ups", new { organisation = Org, credits = 8, note = "rehearsal second top-up" }), HttpStatusCode.OK);

        // An app's own database and role, as Dock makes them: its own owner, closed to everyone else.
        await Psql("endgame", $"CREATE ROLE app_rehearsal LOGIN PASSWORD '{appPassword}'");
        await Psql("endgame", "CREATE DATABASE app_rehearsal OWNER app_rehearsal");
        await Psql("endgame", "REVOKE CONNECT ON DATABASE app_rehearsal FROM PUBLIC");
        await Psql("app_rehearsal", "CREATE TABLE notes (id int PRIMARY KEY, body text); INSERT INTO notes VALUES (1, 'written before the backup'); ALTER TABLE notes OWNER TO app_rehearsal");

        var before = await SnapshotAsync(owner, appId, dock);
        Assert.Equal(secretValue, before.Secret);
        Assert.Equal(head, before.Head);
        report.Add($"data: organisation {Org}, app {appId} (repository head {head[..12]}), secret, {before.LedgerRows} ledger rows (balance {before.Balance}), database app_rehearsal");

        // --- Backup, through the Makefile, to the bucket.
        watch.Restart();
        var backup = await Make(Long, "backup");
        var backupSeconds = watch.Elapsed.TotalSeconds;
        var id = backup.Split('\n').Select(l => l.Trim()).Single(l => l.StartsWith("BACKUP_ID=", StringComparison.Ordinal))["BACKUP_ID=".Length..];
        var objects = await s3.ListAsync("endgame/", default);
        var archive = Assert.Single(objects);
        Assert.Equal($"endgame/{BackupNames.FileName(id)}", archive.Key);
        report.Add($"backup {id}: `make backup` took {backupSeconds:0.0} s wall; archive {archive.Size:N0} bytes in the bucket");
        report.Add($"  {backup.Split('\n').FirstOrDefault(l => l.StartsWith("Backup ", StringComparison.Ordinal))?.Trim()}");

        await using (var body = await s3.GetAsync(archive.Key, default))
        {
            using var copy = new MemoryStream();
            await body.CopyToAsync(copy);
            var bytes = copy.ToArray();
            Assert.Equal("EGBK"u8.ToArray(), bytes[..4]);
            Assert.Equal(-1, bytes.AsSpan().IndexOf(Encoding.UTF8.GetBytes(secretValue)));
            Assert.Equal(-1, bytes.AsSpan().IndexOf("written before the backup"u8));
        }

        // --- Destroy: every volume of the stack goes. The bucket is elsewhere.
        await Compose(TimeSpan.FromMinutes(5), "down", "-v", "--remove-orphans");
        var volumes = await Docker("volume", "ls", "-q", "--filter", $"label=com.docker.compose.project={Project}");
        Assert.Equal("", volumes.Trim());
        report.Add("destroyed: the stack's containers and every volume (database, repositories, local backups)");

        // --- Restore onto the now-empty stack, through the Makefile.
        watch.Restart();
        var restore = await Make(Long, "restore", $"BACKUP={id}");
        var restoreSeconds = watch.Elapsed.TotalSeconds;
        var lines = restore.Split('\n').Select(l => l.Trim()).ToList();
        string Value(string key) => lines.Single(l => l.StartsWith(key + "=", StringComparison.Ordinal))[(key.Length + 1)..];
        report.Add($"restore: `make restore` took {restoreSeconds:0.0} s wall (stop, empty postgres + ops up, restore, stack up); " +
            $"verify {Value("RESTORE_VERIFY_SECONDS")} s, restore itself {Value("RESTORE_SECONDS")} s");

        // --- Everything is back.
        using var ownerAfter = await SignInAsync(OwnerEmail, "Rehearsal owner");
        var after = await SnapshotAsync(ownerAfter, appId, dock);
        Assert.Equal(before.Head, after.Head);
        Assert.Equal(secretValue, after.Secret);
        Assert.Equal(before.Balance, after.Balance);
        Assert.Equal(before.LedgerRows, after.LedgerRows);
        Assert.Equal(before.TopUps, after.TopUps);
        Assert.Equal(before.SecretNames, after.SecretNames);
        Assert.Contains("notes", after.Tree);
        Assert.Equal("written before the backup", await PsqlAs("app_rehearsal", appPassword, "app_rehearsal", "SELECT body FROM notes WHERE id = 1"));
        report.Add($"verified: org, app and tree; repository head {after.Head[..12]}; secret decrypts through the platform API; balance {after.Balance} and {after.LedgerRows} ledger rows; app database readable by its own role and password");

        // --- A second restore over the live data is refused, and changes nothing.
        var (exit, _, error) = await RunAsync(TimeSpan.FromMinutes(5), "sh", "-c", $"{ComposeCommand} exec -T ops /app/Endgame.Ops restore {id}");
        Assert.NotEqual(0, exit);
        Assert.Contains("Refusing to restore over data that is already here", error);
        Assert.Equal(before.LedgerRows, (await SnapshotAsync(ownerAfter, appId, dock)).LedgerRows);
        report.Add("refused: restoring again over the non-empty stack without OVERWRITE=1");
    }

    private sealed record Snapshot(string Head, string Secret, decimal Balance, long LedgerRows, string TopUps, string SecretNames, string Tree);

    private async Task<Snapshot> SnapshotAsync(HttpClient owner, string appId, HttpClient dock)
    {
        var repository = await Expect(await dock.GetAsync($"/internal/repos/{appId}"), HttpStatusCode.OK);
        var credits = await Expect(await owner.GetAsync($"/api/credits?scope={Org}"), HttpStatusCode.OK);
        var secrets = await Expect(await owner.GetAsync($"/api/secrets?scope={Org}/ops/drill/notes"), HttpStatusCode.OK);
        var tree = await (await owner.GetAsync($"/api/tree?organisation={Org}")).Content.ReadAsStringAsync();
        var rows = long.Parse(await Psql("endgame", "SELECT count(*) FROM credit_entries"), CultureInfo.InvariantCulture);
        return new Snapshot(
            (string)repository["head"]!,
            await DecryptSecretAsync(appId),
            (decimal)credits["balance"]!,
            rows,
            credits["topUps"]!.ToJsonString(),
            string.Join(",", secrets["effective"]!.AsArray().Select(s => (string)s!["name"]!).Order(StringComparer.Ordinal)),
            tree);
    }

    /// <summary>The app's view: a fresh app token from the control plane, then the platform API's secret read — which only works if the vault can still unseal it.</summary>
    private async Task<string> DecryptSecretAsync(string appId)
    {
        var minted = await Compose(TimeSpan.FromMinutes(1), "exec", "-T", "control-plane", "curl", "-fsS", "-X", "POST",
            "-H", $"Authorization: Bearer {serviceToken}", $"http://127.0.0.1:8080/internal/apps/{appId}/token");
        var token = (string)JsonNode.Parse(minted)!["token"]!;
        var secret = await Compose(TimeSpan.FromMinutes(1), "exec", "-T", "control-plane", "curl", "-fsS",
            "-H", $"Authorization: Bearer {token}", "http://127.0.0.1:8080/platform/v1/secrets/REHEARSAL_SECRET");
        return (string)JsonNode.Parse(secret)!["value"]!;
    }

    private async Task<HttpClient> SignInAsync(string email, string displayName)
    {
        var client = new HttpClient(new HttpClientHandler { CookieContainer = new CookieContainer(), UseCookies = true })
        {
            BaseAddress = new Uri($"http://localhost:{edgePort}"),
            Timeout = TimeSpan.FromMinutes(2),
        };
        client.DefaultRequestHeaders.Add("Origin", $"http://localhost:{edgePort}");
        await WaitAsync($"the development sign-in for {email}", async () =>
        {
            var response = await client.PostAsJsonAsync("/api/auth/development", new { email, displayName });
            return response.IsSuccessStatusCode;
        }, TimeSpan.FromMinutes(2));
        return client;
    }

    private async Task<HttpStatusCode> CreateBucketAsync()
    {
        try
        {
            using var http = new HttpClient();
            var now = DateTimeOffset.UtcNow;
            var amzDate = now.UtcDateTime.ToString("yyyyMMdd'T'HHmmss'Z'", CultureInfo.InvariantCulture);
            var headers = new Dictionary<string, string>
            {
                ["host"] = $"127.0.0.1:{s3Port}",
                ["x-amz-content-sha256"] = SigV4.EmptyPayloadHash,
                ["x-amz-date"] = amzDate,
            };
            using var request = new HttpRequestMessage(HttpMethod.Put, $"http://127.0.0.1:{s3Port}/{Bucket}");
            request.Headers.TryAddWithoutValidation("x-amz-content-sha256", SigV4.EmptyPayloadHash);
            request.Headers.TryAddWithoutValidation("x-amz-date", amzDate);
            request.Headers.TryAddWithoutValidation("Authorization", SigV4.Authorization("PUT", $"/{Bucket}", [], headers, SigV4.EmptyPayloadHash, now, "us-east-1", s3Access, s3Secret));
            using var response = await http.SendAsync(request);
            return response.StatusCode;
        }
        catch (HttpRequestException)
        {
            return HttpStatusCode.ServiceUnavailable;
        }
    }

    private Dictionary<string, string> StackEnvironment() => new()
    {
        ["COMPOSE_PROJECT_NAME"] = Project,
        ["OPS_COMPOSE"] = ComposeCommand,
        ["OPS_HOST_PORT"] = opsPort.ToString(CultureInfo.InvariantCulture),
        ["OPS_S3_NETWORK"] = S3Network,
        ["EDGE_HOST_PORT"] = edgePort.ToString(CultureInfo.InvariantCulture),
        ["POSTGRES_HOST_PORT"] = postgresPort.ToString(CultureInfo.InvariantCulture),
        ["MAIL_UI_HOST_PORT"] = mailPort.ToString(CultureInfo.InvariantCulture),
        ["DOCK_HOST_PORT"] = dockPort.ToString(CultureInfo.InvariantCulture),
        ["DOCK_SUBNET_POOL"] = "10.219.0.0/16",
        ["ENDGAME_SERVICE_TOKEN"] = serviceToken,
        // The test stack's own throwaway secrets: never the developer's .env values.
        ["POSTGRES_PASSWORD"] = "rehearsal_" + serviceToken[^12..],
        ["ENDGAME_VAULT_MASTER_KEY"] = "72656865617273616c2d7661756c742d6b65792d6e6f742d7365637265742121",
        ["DOCK_SECRET_KEY"] = "rehearsal_dock_secret_key_0123456789abcdef",
        ["ENDGAME_BACKUP_KEY"] = "72656865617273616c2d6261636b75702d6b65792d6e6f742d73656372657421",
        ["ENDGAME_BACKUP_S3_ENDPOINT"] = "http://s3:7070",
        ["ENDGAME_BACKUP_S3_BUCKET"] = Bucket,
        ["ENDGAME_BACKUP_S3_ACCESS_KEY_ID"] = s3Access,
        ["ENDGAME_BACKUP_S3_SECRET_ACCESS_KEY"] = s3Secret,
        ["ENDGAME_BACKUP_S3_REGION"] = "us-east-1",
        ["ENDGAME_CONTROL_PLANE_ENVIRONMENT"] = "Development",
        ["ENDGAME_DEV_LOGIN"] = "true",
        ["ENDGAME_OPERATORS"] = OperatorEmail,
        // No hosting charges land between the snapshot and the backup.
        ["ENDGAME_USAGE_REPORT_SECONDS"] = "3600",
        ["OPENROUTER_API_KEY"] = "",
        ["CLOUDFLARE_API_TOKEN"] = "",
    };

    private Task<string> Compose(TimeSpan timeout, params string[] arguments) =>
        CheckedAsync(timeout, "sh", "-c", ComposeCommand + " " + string.Join(' ', arguments.Select(Quote)));

    private Task<string> Make(TimeSpan timeout, params string[] arguments) =>
        CheckedAsync(timeout, "make", ["-C", repositoryRoot, "--no-print-directory", .. arguments]);

    private async Task<string> Psql(string database, string sql) =>
        (await Compose(TimeSpan.FromMinutes(1), "exec", "-T", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-U", "endgame", "-d", database, "-tAc", sql)).Trim();

    private async Task<string> PsqlAs(string role, string password, string database, string sql) =>
        (await Compose(TimeSpan.FromMinutes(1), "exec", "-T", "-e", $"PGPASSWORD={password}", "postgres",
            "psql", "-h", "127.0.0.1", "-v", "ON_ERROR_STOP=1", "-U", role, "-d", database, "-tAc", sql)).Trim();

    private Task<string> Docker(params string[] arguments) => CheckedAsync(TimeSpan.FromMinutes(5), "docker", arguments);

    private async Task TearDownAsync()
    {
        await RunAsync(TimeSpan.FromMinutes(5), "sh", "-c", $"{ComposeCommand} down -v --remove-orphans --rmi local");
        foreach (var kind in new[] { "ps -aq", "network ls -q", "images -q" })
        {
            var (_, ids, _) = await RunAsync(TimeSpan.FromMinutes(1), "sh", "-c", $"docker {kind} --filter label=endgame.dock={Project}");
            foreach (var resource in ids.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            {
                var remove = kind switch { "ps -aq" => "rm -f -v", "network ls -q" => "network rm", _ => "image rm -f" };
                await RunAsync(TimeSpan.FromMinutes(1), "sh", "-c", $"docker {remove} {resource}");
            }
        }

        await RunAsync(TimeSpan.FromMinutes(1), "docker", "rm", "-f", "-v", S3Container);
        await RunAsync(TimeSpan.FromMinutes(1), "docker", "network", "rm", S3Network);
    }

    private static async Task<JsonObject> Expect(HttpResponseMessage response, HttpStatusCode status)
    {
        var text = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == status, $"{response.RequestMessage?.Method} {response.RequestMessage?.RequestUri} → {(int)response.StatusCode}: {text[..Math.Min(400, text.Length)]}");
        return text.Length > 0 && JsonNode.Parse(text) is JsonObject json ? json : [];
    }

    private static async Task WaitAsync(string what, Func<Task<bool>> ready, TimeSpan timeout)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (true)
        {
            try
            {
                if (await ready())
                {
                    return;
                }
            }
            catch (HttpRequestException) when (DateTime.UtcNow < deadline)
            {
            }

            if (DateTime.UtcNow >= deadline)
            {
                throw new TimeoutException($"{what} was not ready within {timeout}.");
            }

            await Task.Delay(1000);
        }
    }

    private async Task<string> CheckedAsync(TimeSpan timeout, string file, params string[] arguments)
    {
        var (exit, stdout, stderr) = await RunAsync(timeout, file, arguments);
        if (exit != 0)
        {
            throw new InvalidOperationException($"{file} {string.Join(' ', arguments.Take(6))} failed ({exit}):\n{Tail(stderr)}\n{Tail(stdout)}");
        }

        return stdout;
    }

    private static string Tail(string text) => text.Length > 4000 ? text[^4000..] : text;

    private async Task<(int Exit, string Stdout, string Stderr)> RunAsync(TimeSpan timeout, string file, params string[] arguments)
    {
        var start = new ProcessStartInfo(file)
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            WorkingDirectory = repositoryRoot,
        };
        foreach (var argument in arguments)
        {
            start.ArgumentList.Add(argument);
        }

        foreach (var (key, value) in StackEnvironment())
        {
            start.Environment[key] = value;
        }

        using var process = Process.Start(start)!;
        using var cancel = new CancellationTokenSource(timeout);
        var stdout = process.StandardOutput.ReadToEndAsync(cancel.Token);
        var stderr = process.StandardError.ReadToEndAsync(cancel.Token);
        try
        {
            await process.WaitForExitAsync(cancel.Token);
        }
        catch (OperationCanceledException)
        {
            process.Kill(entireProcessTree: true);
            throw new TimeoutException($"{file} {string.Join(' ', arguments.Take(4))} took longer than {timeout}.");
        }

        return (process.ExitCode, await stdout, await stderr);
    }

    private static string Quote(string argument) =>
        argument.All(c => char.IsLetterOrDigit(c) || "-_./:=@,".Contains(c, StringComparison.Ordinal)) ? argument : "'" + argument.Replace("'", "'\\''", StringComparison.Ordinal) + "'";

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
            if (File.Exists(Path.Combine(dir.FullName, "docker-compose.yml")) && File.Exists(Path.Combine(dir.FullName, "Makefile")))
            {
                return dir.FullName;
            }
        }

        throw new InvalidOperationException("The repository root was not found above the test output directory.");
    }
}
