using System.Net.Http.Headers;
using System.Text;
using Endgame.Harness.Workspaces;
using Endgame.Hosting.Contracts;
using Endgame.Runner.Platform;
using Endgame.Tests.Hosting;

namespace Endgame.Tests.Harness;

/// <summary>
/// The harness's tools through the real Dock on the real Docker Engine (the hosting collection's
/// stack, every resource named <c>test-endgame-*</c>): bytes and line endings survive the container
/// boundary, the floor holds, and a scripted agent edits, verifies and commits through it.
/// </summary>
[Collection(HostingCollection.Name)]
[Trait("Category", "Docker")]
public sealed class DockWorkspaceTests(HostingEnvironment env)
{
    [DockerFact]
    public async Task The_workspace_tools_work_through_dock_with_exact_bytes_and_the_floor_holding()
    {
        var (dock, provider) = Clients();
        var app = Guid.NewGuid();
        var run = Guid.NewGuid();
        await dock.EnsureRepositoryAsync(app, CancellationToken.None);
        var (workspace, recreated) = await provider.EnsureAsync(run, app, DateTimeOffset.UtcNow.AddMinutes(10), null, CancellationToken.None);
        try
        {
            Assert.True(recreated);
            Assert.False((await provider.EnsureAsync(run, app, DateTimeOffset.UtcNow.AddMinutes(10), null, CancellationToken.None)).Recreated);

            // A Windows-line-ending file, edited with Unix line endings: matched, and its own endings kept, byte for byte.
            await workspace.WriteBytesAsync("/workspace/notes/crlf.txt", Encoding.UTF8.GetBytes("alpha\r\nbeta\r\ngamma\r\n"), CancellationToken.None);
            var edit = await ToolTests.Call(new Endgame.Harness.Tools.EditFileTool(), workspace, new { path = "notes/crlf.txt", old_string = "alpha\nbeta", new_string = "alpha\nBETA" });
            Assert.False(edit.IsError, edit.Content);
            Assert.Equal("alpha\r\nBETA\r\ngamma\r\n", Encoding.UTF8.GetString((await workspace.ReadBytesAsync("/workspace/notes/crlf.txt", CancellationToken.None))!));

            var read = await ToolTests.Call(new Endgame.Harness.Tools.ReadFileTool(), workspace, new { path = "notes/crlf.txt" });
            Assert.Equal("    1\talpha\n    2\tBETA\n    3\tgamma\n", read.Content);
            Assert.Contains("notes/crlf.txt", (await ToolTests.Call(new Endgame.Harness.Tools.ListFilesTool(), workspace, new { })).Content, StringComparison.Ordinal);
            Assert.Contains("notes/crlf.txt:2:BETA", (await ToolTests.Call(new Endgame.Harness.Tools.SearchTool(), workspace, new { pattern = "BETA" })).Content, StringComparison.Ordinal);
            var ran = await ToolTests.Call(new Endgame.Harness.Tools.RunTool(), workspace, new { command = "id -u && test ! -S /var/run/docker.sock && echo no-socket" });
            Assert.StartsWith("[exit code 0]\n1654\nno-socket", ran.Content, StringComparison.Ordinal);
            Assert.Contains("notes/crlf.txt", (await ToolTests.Call(new Endgame.Harness.Tools.GitDiffTool(), workspace, new { stat_only = true })).Content, StringComparison.Ordinal);

            // Dock's own floor, behind the harness's: a link out of the workspace cannot be written through.
            await workspace.ExecAsync(WorkspaceCommand.Line("ln -s /etc out-link"), CancellationToken.None);
            var refused = await Assert.ThrowsAsync<WorkspaceException>(() => workspace.WriteBytesAsync("/workspace/out-link/x", [1], CancellationToken.None));
            Assert.Equal(DockProblemCodes.ProtectedPath, refused.Code);
            Assert.Null(await workspace.ReadBytesAsync("/workspace/no-such-file", CancellationToken.None));

            // A scripted agent through the real workspace: edit, verify, commit — the commit lands on the app's branch.
            var model = new ScriptedModel()
                .ThenTool("write_file", new { path = "notes/feature.txt", content = "made by the agent\n" })
                .ThenTool("run", new { command = "cat notes/feature.txt" })
                .ThenTool("commit", new { message = "Add the feature note" })
                .ThenText("Done.");
            var agent = TestAgents.Builder(change: a => a with { StopHooks = [], AuthorName = "Ada Employee", AuthorEmail = "ada@employees.endgame.test" });
            var (result, log) = await TestAgents.RunAsync(agent, model, workspace);
            Assert.True(result.Completed);
            Assert.Contains("made by the agent", log.Events.Where(e => e.Type == "tool.result").ElementAt(1).Payload["content"]!.GetValue<string>(), StringComparison.Ordinal);
            var head = (await dock.EnsureRepositoryAsync(app, CancellationToken.None)).Head;
            Assert.Equal(result.State.Commits.Single(), head);
        }
        finally
        {
            await provider.ReleaseAsync(run, CancellationToken.None);
        }

        Assert.Null(await dock.GetWorkspaceAsync(run, CancellationToken.None));
    }

    private (DockClient Dock, DockWorkspaceProvider Provider) Clients()
    {
        var http = new HttpClient { BaseAddress = env.DockUrl, Timeout = TimeSpan.FromMinutes(5) };
        http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue(HostingConventions.ServiceTokenScheme, env.Token);
        var dock = new DockClient(http);
        return (dock, new DockWorkspaceProvider(dock));
    }
}
