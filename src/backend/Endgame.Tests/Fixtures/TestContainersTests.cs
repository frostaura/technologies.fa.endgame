using Endgame.Tests.Hosting;

namespace Endgame.Tests.Fixtures;

/// <summary>
/// R3-3: test runs leaked 54 anonymous volumes (74.9 GB) in one day. A test container is removed with its volumes, and one
/// whose test host is gone is removed by the next run — only containers labelled as this project's tests.
/// </summary>
public sealed class TestContainersTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 26, 18, 0, 0, TimeSpan.Zero);

    [Fact]
    public void A_container_is_stale_only_when_its_test_host_is_gone()
    {
        var started = Now.AddMinutes(-10);
        DateTimeOffset? Running(int _) => started;
        DateTimeOffset? Gone(int _) => null;
        var label = started.ToUnixTimeSeconds().ToString(System.Globalization.CultureInfo.InvariantCulture);

        Assert.False(TestContainers.IsStale("4242", label, Now.AddMinutes(-5), Now, Running));
        Assert.True(TestContainers.IsStale("4242", label, Now.AddMinutes(-5), Now, Gone));
        // The id was reused by a process that started later: a different owner.
        Assert.True(TestContainers.IsStale("4242", Now.AddHours(-2).ToUnixTimeSeconds().ToString(System.Globalization.CultureInfo.InvariantCulture), Now.AddHours(-2), Now, Running));
        // From before the labels: stale only once older than any test run, so another lane's run in progress is left alone.
        Assert.False(TestContainers.IsStale("<no value>", "<no value>", Now.AddMinutes(-30), Now, Running));
        Assert.True(TestContainers.IsStale("<no value>", "<no value>", Now.AddHours(-4), Now, Running));
    }

    [DockerFact]
    public async Task A_container_whose_test_host_is_gone_is_removed_with_its_anonymous_volume_and_a_live_one_is_kept()
    {
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var dead = $"endgame-test-probe-dead-{suffix}";
        var live = $"endgame-test-probe-live-{suffix}";
        string[] Run(string name, params string[] labels) =>
            ["run", "-d", "--name", name, .. labels, "-v", "/scratch", "--entrypoint", "sleep", PostgresServer.Image, "300"];
        try
        {
            // Labelled with a value of this test's own, so the fixtures' sweeps running in parallel never touch them.
            var value = $"probe-{suffix}";
            var mine = TestContainers.Labels().Select(l => l == $"{TestContainers.Label}=1" ? $"{TestContainers.Label}={value}" : l).ToArray();
            await DockerCli.CheckedAsync(TimeSpan.FromMinutes(5), Run(dead, "--label", $"{TestContainers.Label}={value}", "--label", $"{TestContainers.OwnerLabel}=999999", "--label", $"{TestContainers.StartedLabel}=1"));
            await DockerCli.CheckedAsync(TimeSpan.FromMinutes(5), Run(live, mine));
            var volume = (await DockerCli.CheckedAsync(TimeSpan.FromMinutes(1), "inspect", "-f", "{{range .Mounts}}{{.Name}}{{end}}", dead)).Trim();
            Assert.NotEmpty(volume);

            var removed = await TestContainers.RemoveStaleAsync(value);

            Assert.Equal([dead], removed);
            Assert.NotEqual(0, (await DockerCli.RunAsync(TimeSpan.FromSeconds(30), "inspect", dead)).ExitCode);
            Assert.NotEqual(0, (await DockerCli.RunAsync(TimeSpan.FromSeconds(30), "volume", "inspect", volume)).ExitCode);
            Assert.Equal(0, (await DockerCli.RunAsync(TimeSpan.FromSeconds(30), "inspect", live)).ExitCode);
        }
        finally
        {
            await DockerCli.RunAsync(TimeSpan.FromMinutes(1), "rm", "-f", "-v", dead);
            await DockerCli.RunAsync(TimeSpan.FromMinutes(1), "rm", "-f", "-v", live);
        }
    }
}
