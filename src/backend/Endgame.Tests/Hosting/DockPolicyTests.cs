using System.Text;
using Endgame.Dock.Policy;
using Endgame.Dock.Repositories;
using Endgame.Hosting.Contracts;

namespace Endgame.Tests.Hosting;

public sealed class SubnetAllocatorTests
{
    private static readonly Ipv4Cidr Pool = Ipv4Cidr.Parse("10.213.0.0/16");

    [Fact]
    public void The_first_slot_of_an_empty_pool_is_its_first_28() =>
        Assert.Equal("10.213.0.0/28", SubnetAllocator.Next(Pool, [])!.Value.ToString());

    [Fact]
    public void Slots_in_use_are_skipped()
    {
        var used = new[] { Ipv4Cidr.Parse("10.213.0.0/28"), Ipv4Cidr.Parse("10.213.0.16/28") };
        Assert.Equal("10.213.0.32/28", SubnetAllocator.Next(Pool, used)!.Value.ToString());
    }

    [Fact]
    public void A_wider_network_made_by_hand_inside_the_pool_is_never_overlapped()
    {
        var used = new[] { Ipv4Cidr.Parse("10.213.0.0/24") };
        Assert.Equal("10.213.1.0/28", SubnetAllocator.Next(Pool, used)!.Value.ToString());
    }

    [Fact]
    public void Networks_outside_the_pool_do_not_matter()
    {
        var used = new[] { Ipv4Cidr.Parse("172.17.0.0/16"), Ipv4Cidr.Parse("10.0.0.0/16") };
        Assert.Equal("10.213.0.0/28", SubnetAllocator.Next(Pool, used)!.Value.ToString());
    }

    [Fact]
    public void A_full_pool_yields_nothing() =>
        Assert.Null(SubnetAllocator.Next(Ipv4Cidr.Parse("10.213.0.0/27"), [Ipv4Cidr.Parse("10.213.0.0/28"), Ipv4Cidr.Parse("10.213.0.16/28")]));

    [Fact]
    public void A_gap_between_used_slots_is_reused()
    {
        var used = new[] { Ipv4Cidr.Parse("10.213.0.0/28"), Ipv4Cidr.Parse("10.213.0.32/28") };
        Assert.Equal("10.213.0.16/28", SubnetAllocator.Next(Pool, used)!.Value.ToString());
    }

    [Theory]
    [InlineData("10.213.0.5/28", "10.213.0.0/28")]
    [InlineData("192.168.1.1/32", "192.168.1.1/32")]
    public void Cidrs_are_normalised_to_their_network(string text, string expected) =>
        Assert.Equal(expected, Ipv4Cidr.Parse(text).ToString());

    [Theory]
    [InlineData("")]
    [InlineData("10.0.0.0")]
    [InlineData("10.0.0.0/33")]
    [InlineData("fe80::/64")]
    [InlineData("nonsense/8")]
    public void Invalid_cidrs_are_refused(string text) => Assert.False(Ipv4Cidr.TryParse(text, out _));
}

public sealed class WorkspacePathsTests
{
    [Theory]
    [InlineData("src/app.cs", "/workspace/src/app.cs", "src/app.cs")]
    [InlineData("./src/../README.md", "/workspace/README.md", "README.md")]
    [InlineData("/workspace/src", "/workspace/src", "src")]
    [InlineData(".", "/workspace", "")]
    [InlineData("/workspace/", "/workspace", "")]
    [InlineData(".github/workflows/ci.yml", "/workspace/.github/workflows/ci.yml", ".github/workflows/ci.yml")]
    [InlineData(".gitignore", "/workspace/.gitignore", ".gitignore")]
    public void Paths_inside_the_root_resolve(string requested, string absolute, string relative)
    {
        var decision = WorkspacePaths.Resolve(requested);
        Assert.True(decision.Allowed, decision.Reason);
        Assert.Equal(absolute, decision.AbsolutePath);
        Assert.Equal(relative, decision.RelativePath);
    }

    [Theory]
    [InlineData("../etc/passwd")]
    [InlineData("src/../../etc/passwd")]
    [InlineData("/etc/passwd")]
    [InlineData("/workspaces/other")]
    [InlineData("/workspace-evil/x")]
    [InlineData(".git/config")]
    [InlineData(".git")]
    [InlineData("src/.git/hooks/pre-commit")]
    [InlineData(".GIT/config")]
    [InlineData("src/../.git/HEAD")]
    [InlineData("a\0b")]
    [InlineData("a\\..\\b")]
    [InlineData(null)]
    public void Paths_over_the_floor_are_refused(string? requested) => Assert.False(WorkspacePaths.Resolve(requested).Allowed);

    [Theory]
    [InlineData("/etc")]
    [InlineData("/workspace/.git/objects")]
    [InlineData("/home/app/.nuget")]
    public void A_symbolic_link_resolving_over_the_floor_is_refused(string resolved) =>
        Assert.False(WorkspacePaths.CheckResolved(resolved).Allowed);

    [Fact]
    public void A_symbolic_link_resolving_inside_is_allowed() =>
        Assert.True(WorkspacePaths.CheckResolved("/workspace/src/real.cs").Allowed);
}

public sealed class OutputCaptureTests
{
    [Fact]
    public void Output_under_the_cap_is_kept_whole()
    {
        var capture = new OutputCapture(100);
        capture.Append("hello "u8);
        capture.Append("world"u8);
        Assert.Equal("hello world", capture.ToString());
        Assert.False(capture.Truncated);
    }

    [Fact]
    public void Output_over_the_cap_keeps_head_and_tail_and_counts_the_middle()
    {
        var capture = new OutputCapture(20);
        foreach (var chunk in new[] { "HEAD-0123", "456789-middle-that-is-dropped-", "end-TAIL" })
        {
            capture.Append(Encoding.UTF8.GetBytes(chunk));
        }

        var text = capture.ToString();
        Assert.True(capture.Truncated);
        Assert.StartsWith("HEAD-01234", text, StringComparison.Ordinal);
        Assert.EndsWith("d-end-TAIL", text, StringComparison.Ordinal);
        Assert.Contains("bytes omitted", text, StringComparison.Ordinal);
        Assert.Equal(47, capture.TotalBytes);
    }
}

public sealed class OpaqueNamesTests
{
    private static readonly OpaqueNames Names = new(Encoding.UTF8.GetBytes("a-test-key-that-is-long-enough-to-use"));

    [Fact]
    public void Names_are_stable_and_say_nothing_about_the_app()
    {
        var app = Guid.Parse("5b3c3c3e-8e7d-4c62-9a9d-0c1e5f7a2b11");
        Assert.Equal(Names.Database(app), Names.Database(app));
        Assert.Equal(Names.Password(app), Names.Password(app));
        Assert.DoesNotContain("5b3c", Names.Database(app), StringComparison.Ordinal);
        Assert.True(OpaqueNames.IsAppDatabase(Names.Database(app)));
        Assert.Matches("^r_[0-9a-f]{24}$", Names.Role(app));
        Assert.Matches("^[A-Za-z0-9]{40,}$", Names.Password(app));
    }

    [Fact]
    public void Two_apps_never_share_a_name_and_another_key_gives_other_names()
    {
        var a = Guid.NewGuid();
        var b = Guid.NewGuid();
        Assert.NotEqual(Names.Database(a), Names.Database(b));
        var other = new OpaqueNames(Encoding.UTF8.GetBytes("another-key-that-is-also-long-enough"));
        Assert.NotEqual(Names.Database(a), other.Database(a));
        Assert.NotEqual(Names.Password(a), other.Password(a));
    }

    [Theory]
    [InlineData("postgres")]
    [InlineData("endgame")]
    [InlineData("template1")]
    [InlineData("d_ZZZ")]
    public void Platform_databases_are_never_taken_for_an_apps(string name) => Assert.False(OpaqueNames.IsAppDatabase(name));
}

public sealed class EgressRulesTests
{
    [Theory]
    [InlineData("Example.COM", "example.com")]
    [InlineData("*.nuget.org", "*.nuget.org")]
    [InlineData("api.github.com.", "api.github.com")]
    public void Hosts_are_normalised(string entry, string expected) => Assert.Equal(expected, EgressRules.NormaliseHost(entry));

    [Theory]
    [InlineData("https://example.com")]
    [InlineData("example.com:443")]
    [InlineData("example.com/path")]
    [InlineData("localhost")]
    [InlineData("*")]
    [InlineData("a.*.com")]
    [InlineData("10.0.0.1/8")]
    [InlineData("")]
    public void Anything_but_a_host_name_is_refused(string entry) => Assert.Null(EgressRules.NormaliseHost(entry));

    [Fact]
    public void The_policy_allows_each_network_only_its_own_hosts_and_denies_private_destinations_first()
    {
        var text = EgressRules.Render(
        [
            new EgressRule("appnet-b", Ipv4Cidr.Parse("10.213.0.16/28"), ["registry.npmjs.org"], Platform: false),
            new EgressRule("appnet-a", Ipv4Cidr.Parse("10.213.0.0/28"), ["example.com", "*.example.com", "api.example.com"], Platform: true),
        ], "control-plane", 8080);
        var lines = text.Split('\n', StringSplitOptions.RemoveEmptyEntries).Where(l => !l.StartsWith('#')).ToList();
        Assert.Contains("acl endgame_n0_src src 10.213.0.0/28", lines);
        Assert.Contains("acl endgame_n1_src src 10.213.0.16/28", lines);
        Assert.Contains("http_access allow endgame_n0_src endgame_platform_host endgame_platform_port", lines);
        Assert.DoesNotContain("http_access allow endgame_n1_src endgame_platform_host endgame_platform_port", lines);
        Assert.Contains("acl endgame_n0_dst dstdomain .example.com", lines); // the wildcard swallowed the rest
        Assert.Contains("acl endgame_n1_dst dstdomain registry.npmjs.org", lines);
        var denyPrivate = lines.IndexOf("http_access deny endgame_private");
        Assert.True(denyPrivate > lines.IndexOf("http_access allow endgame_n0_src endgame_platform_host endgame_platform_port"));
        Assert.True(denyPrivate < lines.IndexOf("http_access allow endgame_n0_src endgame_n0_dst"));
    }

    [Fact]
    public void A_network_with_no_hosts_gets_no_allow_at_all()
    {
        var text = EgressRules.Render([new EgressRule("wsnet", Ipv4Cidr.Parse("10.213.0.0/28"), [], Platform: false)], "control-plane", 8080);
        Assert.DoesNotContain("http_access allow", text, StringComparison.Ordinal);
    }

    [Fact]
    public void Lists_with_bad_entries_report_them()
    {
        var accepted = EgressRules.NormaliseAll(["example.com", "http://bad", "EXAMPLE.com"], out var rejected);
        Assert.Equal(["example.com"], accepted);
        Assert.Equal(["http://bad"], rejected);
    }
}

public sealed class MemoryBudgetTests
{
    private const long Mb = 1024 * 1024;

    [Fact]
    public void An_app_is_admitted_while_real_use_plus_its_estimate_fits() =>
        Assert.True(MemoryBudget.Admit(1024 * Mb, [300 * Mb, 300 * Mb], 400 * Mb).Admitted);

    [Fact]
    public void An_app_that_would_overflow_the_budget_is_refused()
    {
        var decision = MemoryBudget.Admit(1024 * Mb, [300 * Mb, 300 * Mb], 500 * Mb);
        Assert.False(decision.Admitted);
        Assert.Equal(600 * Mb, decision.UsedBytes);
    }

    [Fact]
    public void Forty_small_apps_fit_where_forty_limits_would_not()
    {
        // ARCH-005: forty idle apps at 40–55 MB fit in a 4 GB budget; forty 256 MB limits would not.
        var running = Enumerable.Repeat(55 * Mb, 39);
        Assert.True(MemoryBudget.Admit(4096 * Mb, running, 64 * Mb).Admitted);
        Assert.False(MemoryBudget.Admit(4096 * Mb, Enumerable.Repeat(256 * Mb, 39), 256 * Mb).Admitted);
    }
}

public sealed class LimitsPolicyTests
{
    private static readonly ResourceLimits Defaults = new(1, 256, 128);
    private static readonly ResourceLimits Maxima = new(2, 1024, 512);

    [Fact]
    public void No_request_gives_the_defaults() => Assert.Equal(Defaults, LimitsPolicy.Resolve(null, Defaults, Maxima));

    [Fact]
    public void Requests_are_held_to_the_maxima() =>
        Assert.Equal(new ResourceLimits(2, 1024, 512), LimitsPolicy.Resolve(new ResourceLimits(64, 1_000_000, 100_000), Defaults, Maxima));

    [Fact]
    public void Zero_or_negative_fields_fall_back_to_the_defaults() =>
        Assert.Equal(new ResourceLimits(1, 512, 128), LimitsPolicy.Resolve(new ResourceLimits(0, 512, -1), Defaults, Maxima));
}

public sealed class WakeGateTests
{
    [Fact]
    public async Task No_more_than_the_concurrency_run_together()
    {
        var gate = new WakeGate(2, TimeSpan.Zero, TimeProvider.System);
        var running = 0;
        var peak = 0;
        var starts = Enumerable.Range(0, 10).Select(_ => gate.RunAsync(async () =>
        {
            var now = Interlocked.Increment(ref running);
            InterlockedMax(ref peak, now);
            await Task.Delay(30);
            Interlocked.Decrement(ref running);
            return true;
        }, CancellationToken.None));
        await Task.WhenAll(starts);
        Assert.Equal(2, peak);
    }

    [Fact]
    public async Task Consecutive_starts_are_spaced()
    {
        var gate = new WakeGate(8, TimeSpan.FromMilliseconds(40), TimeProvider.System);
        var times = new System.Collections.Concurrent.ConcurrentBag<long>();
        var clock = System.Diagnostics.Stopwatch.StartNew();
        await Task.WhenAll(Enumerable.Range(0, 5).Select(_ => gate.RunAsync(() =>
        {
            times.Add(clock.ElapsedMilliseconds);
            return Task.FromResult(true);
        }, CancellationToken.None)));
        var ordered = times.Order().ToList();
        Assert.True(ordered[^1] - ordered[0] >= 4 * 40 - 10, $"starts at {string.Join(",", ordered)}");
    }

    private static void InterlockedMax(ref int target, int value)
    {
        int current;
        while (value > (current = Volatile.Read(ref target)) && Interlocked.CompareExchange(ref target, value, current) != current)
        {
        }
    }
}

public sealed class FilePagingTests
{
    [Fact]
    public void A_file_is_paged_by_line()
    {
        var content = Encoding.UTF8.GetBytes(string.Join('\n', Enumerable.Range(1, 10).Select(i => $"line {i}")) + "\n");
        var page = FilePaging.File("a.txt", content, 3, 4);
        Assert.Equal("line 4\nline 5\nline 6\nline 7", page.Content);
        Assert.Equal(10, page.Total);
        Assert.True(page.HasMore);
        Assert.False(FilePaging.File("a.txt", content, 8, 4).HasMore);
    }

    [Fact]
    public void A_binary_file_is_returned_as_base64()
    {
        var page = FilePaging.File("a.bin", [1, 0, 2], 0, 10);
        Assert.True(page.Binary);
        Assert.Equal(Convert.ToBase64String(new byte[] { 1, 0, 2 }), page.Content);
    }

    [Fact]
    public void A_directory_lists_directories_first_and_pages_entries()
    {
        var page = FilePaging.Directory("", [new("b.cs", "file", 1), new("src", "directory", 0), new("a.cs", "file", 1)], 0, 2);
        Assert.Equal(["src", "a.cs"], page.Entries!.Select(e => e.Name));
        Assert.True(page.HasMore);
    }
}

public sealed class ResourceNamesTests
{
    [Fact]
    public void Production_names_follow_ARCH_004_and_tests_carry_their_prefix()
    {
        var app = Guid.Parse("11111111-2222-3333-4444-555555555555");
        Assert.Equal("app-11111111222233334444555555555555", new ResourceNames("", "endgame").AppContainer(app)); // the control plane's target names it so
        Assert.Equal("ws-11111111-2222-3333-4444-555555555555", new ResourceNames("", "endgame").WorkspaceContainer(app));
        Assert.StartsWith("test-endgame-", new ResourceNames("test-endgame-", "test-endgame").AppNetwork(app), StringComparison.Ordinal);
        Assert.Equal("test-endgame", new ResourceNames("test-endgame-", "test-endgame").Labels(ResourceNames.AppKind, app)[ResourceNames.ManagedByLabel]);
    }
}
