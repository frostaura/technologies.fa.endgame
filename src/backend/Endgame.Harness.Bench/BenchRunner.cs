using System.Diagnostics;
using System.Globalization;
using System.Text.Json.Nodes;
using Endgame.Harness.Context;
using Endgame.Harness.Events;
using Endgame.Harness.Kernel;
using Endgame.Harness.Model;
using Endgame.Harness.Permissions;
using Endgame.Harness.Skills;
using Endgame.Harness.Subagents;
using Endgame.Harness.Tools;
using Endgame.Harness.Workspaces;

namespace Endgame.Harness.Bench;

/// <summary>One benchmark task: what the agent is told, what is overlaid first, and what checks it afterwards.</summary>
public sealed record BenchTask(string Id, string Directory, string Prompt, int ContextTokens, IReadOnlyList<string> ExtraTools, string? Evaluation, int RepairRounds)
{
    public static BenchTask Load(string directory)
    {
        var options = File.Exists(Path.Combine(directory, "bench.json")) ? JsonNode.Parse(File.ReadAllText(Path.Combine(directory, "bench.json")))!.AsObject() : [];
        return new BenchTask(
            Path.GetFileName(directory),
            directory,
            File.ReadAllText(Path.Combine(directory, "task.md")),
            Json.Int(options, "contextTokens") ?? new CompactionOptions().ContextTokens,
            Json.Strings(options, "tools"),
            Json.Str(options, "evaluation"),
            Json.Int(options, "repairRounds") ?? 0);
    }
}

public sealed record CheckStep(string Name, bool Passed, double Seconds, string Tail);

/// <summary>One task on one tier: the outcome and what it took.</summary>
public sealed record CellResult(
    string Task,
    string Model,
    int Repeat,
    bool Passed,
    IReadOnlyList<string> FailedChecks,
    string StopReason,
    int Steps,
    int ToolCalls,
    int EditCalls,
    int FailedEdits,
    int Compactions,
    int Subagents,
    int RepairRounds,
    bool EvaluationFailedFirst,
    decimal CostUsd,
    double WallSeconds,
    string? Error);

/// <summary>Runs a task through the real harness in a fresh workspace, then the hidden checks it never saw.</summary>
public sealed class BenchRunner(OpenRouterGateway gateway, string image, string resultsDirectory)
{
    public const string SystemPrompt = """
        You are an autonomous software engineer working in a repository at /workspace inside a sandboxed
        Linux container with no network access. There is no human to answer questions: make reasonable
        decisions yourself, guided by the existing code, and finish the task completely.

        The repository is a .NET 10 minimal API (EF Core on SQLite, xUnit tests) plus a Vite, React and
        TypeScript front end in web/ (Vitest). Useful commands, run with the `run` tool from /workspace:
          dotnet build Library.slnx
          dotnet test Library.slnx
          dotnet ef migrations add <Name> --project src/Library.Api
          cd web && npm run build && npm test
        Every NuGet and npm package you need is already installed; you cannot install new ones.

        How to work:
        - Explore first with list_files, read_file and search, to learn the code and its conventions.
        - Change files with edit_file (exact text copied from read_file, without the line-number prefix)
          or write_file for new files. Make the smallest change that fully does the job.
        - Verify: build and run the relevant tests after your changes, and fix anything that fails.
        - When everything is done and verified, reply with a short summary of what you changed, and call no more tools.
        """;

    public async Task<CellResult> RunAsync(BenchTask task, string model, int repeat, CancellationToken cancellationToken)
    {
        var id = $"{task.Id}-{model.Replace('/', '_').Replace(':', '_').Replace('.', '-')}-r{repeat}-{Guid.NewGuid().ToString("N")[..6]}".ToLowerInvariant();
        var clock = Stopwatch.StartNew();
        var log = new InMemoryRunLog();
        var runId = Guid.NewGuid();
        Sinks[runId] = log;
        Models[runId] = model;
        string stop = "harness_error";
        var repairs = 0;
        var evaluationFailedFirst = false;
        IReadOnlyList<CheckStep> checks = [];
        string? error = null;
        try
        {
            await using var workspace = await DockerWorkspace.StartAsync(image, id, cancellationToken);
            await workspace.OverlayAsync(Path.Combine(task.Directory, "setup"), cancellationToken);
            await workspace.ExecAsync(WorkspaceCommand.Line("git add -A >/dev/null && git commit -qm baseline"), cancellationToken);

            var agent = Agent(task, runId, "main", repair: false);
            var result = await new AgentLoop(agent, Services(), workspace, log).StartAsync(task.Prompt, cancellationToken);
            stop = result.StopReason;

            // A task with an evaluation: the evaluator's failure goes back to a repair session, capped.
            if (task.Evaluation is { } evaluation)
            {
                for (var round = 1; round <= task.RepairRounds + 1 && result.Completed; round++)
                {
                    await workspace.OverlayAsync(Path.Combine(task.Directory, "evaluation"), cancellationToken);
                    var check = await workspace.ExecAsync(new WorkspaceCommand(null, "exec 2>&1; " + evaluation, 600, 256 * 1024), cancellationToken);
                    await workspace.ExecAsync(WorkspaceCommand.Line("rm -rf tests/Library.Api.Tests/Evaluation"), cancellationToken);
                    if (check.ExitCode == 0)
                    {
                        break;
                    }

                    evaluationFailedFirst |= round == 1;
                    if (round > task.RepairRounds)
                    {
                        stop = "evaluation_failed";
                        break;
                    }

                    repairs++;
                    var repairAgent = Agent(task, runId, $"repair-{round}", repair: true);
                    result = await new AgentLoop(repairAgent, Services(), workspace, log).StartAsync(
                        $"An evaluator checked your work on this task and it failed. Fix what it reports, verify, and reply with what you changed.\n\nThe task was:\n{task.Prompt}\n\nThe evaluation's output:\n{OutputText.Truncate(OutputText.StripAnsi(check.Combined), 6000)}",
                        cancellationToken);
                    stop = result.StopReason;
                }
            }

            checks = await HiddenCheckAsync(workspace, task, cancellationToken);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            error = e.Message;
        }

        var events = log.Events;
        var replies = events.Where(e => e.Type == Endgame.Domain.Runs.RunEventTypes.ModelReplied).ToList();
        var results = events.Where(e => e.Type == HarnessEvents.ToolResult).ToList();
        await WriteLogAsync(id, events, cancellationToken);
        Sinks.TryRemove(runId, out _);
        return new CellResult(
            task.Id,
            model,
            repeat,
            error is null && checks.Count > 0 && checks.All(c => c.Passed),
            checks.Where(c => !c.Passed).Select(c => c.Name).ToList(),
            stop,
            replies.Count,
            results.Count,
            results.Count(e => Json.Str(e.Payload, "name") == "edit_file"),
            results.Count(e => Json.Str(e.Payload, "errorKind") == "edit_failed"),
            events.Count(e => e.Type == HarnessEvents.Message && Json.Str(e.Payload, "kind") == MessageKinds.Compaction),
            events.Count(e => e.Type == HarnessEvents.SubagentStarted),
            repairs,
            evaluationFailedFirst,
            replies.Sum(e => Json.Dec(e.Payload, "costUsd") ?? 0m),
            Math.Round(clock.Elapsed.TotalSeconds, 1),
            error);
    }

    /// <summary>The checks must fail on the untouched starting state, or they prove nothing.</summary>
    public async Task<IReadOnlyList<CheckStep>> BaselineAsync(BenchTask task, CancellationToken cancellationToken)
    {
        await using var workspace = await DockerWorkspace.StartAsync(image, $"baseline-{task.Id}-{Guid.NewGuid().ToString("N")[..6]}", cancellationToken);
        await workspace.OverlayAsync(Path.Combine(task.Directory, "setup"), cancellationToken);
        return await HiddenCheckAsync(workspace, task, cancellationToken);
    }

    public System.Collections.Concurrent.ConcurrentDictionary<Guid, IEventSink> Sinks { get; } = new();

    public System.Collections.Concurrent.ConcurrentDictionary<Guid, string> Models { get; } = new();

    private AgentServices Services() => new() { Model = gateway, Retry = new RetryPolicy(4, TimeSpan.FromSeconds(2)) };

    private static AgentDefinition Agent(BenchTask task, Guid runId, string id, bool repair)
    {
        var tools = new List<ITool> { new ReadFileTool(), new EditFileTool(), new WriteFileTool(), new ListFilesTool(), new SearchTool(), new RunTool(), new GitDiffTool() };
        if (task.ExtraTools.Contains("notes"))
        {
            tools.Add(new NotesTool());
        }

        if (task.ExtraTools.Contains("spawn"))
        {
            tools.Add(new SpawnTool());
        }

        return new AgentDefinition
        {
            Id = id,
            TaskType = "build",
            Scope = "bench",
            RunId = runId,
            SystemPrompt = SystemPrompt,
            Tools = new ToolRegistry(tools),
            Repair = repair,
            Permissions = new PermissionPolicy
            {
                Stage = "build",
                Allow = [PermissionRule.Parse("edit_file"), PermissionRule.Parse("write_file"), PermissionRule.Parse("run")],
            },
            Compaction = new CompactionOptions { ContextTokens = task.ContextTokens },
        };
    }

    private static async Task<IReadOnlyList<CheckStep>> HiddenCheckAsync(DockerWorkspace workspace, BenchTask task, CancellationToken cancellationToken)
    {
        await workspace.OverlayAsync(Path.Combine(task.Directory, "hidden"), cancellationToken);
        var steps = new List<(string Name, string Command)>
        {
            ("dotnet_build", "dotnet build Library.slnx -v q -nologo"),
            ("dotnet_test", "dotnet test Library.slnx --no-build -nologo"),
            ("npm_build", "cd web && npm run build"),
            ("npm_test", "cd web && npm test"),
        };
        var script = Path.Combine(task.Directory, "check.sh");
        if (File.Exists(script))
        {
            await workspace.ExecAsync(WorkspaceCommand.Line("mkdir -p /tmp/bench"), cancellationToken);
            await workspace.WriteBytesAsync("/workspace/.bench-check.sh", await File.ReadAllBytesAsync(script, cancellationToken), cancellationToken);
            steps.Add(("task_check", "bash .bench-check.sh"));
        }

        var results = new List<CheckStep>();
        foreach (var (name, command) in steps)
        {
            var clock = Stopwatch.StartNew();
            var result = await workspace.ExecAsync(new WorkspaceCommand(null, "exec 2>&1; " + command, 480, 256 * 1024), cancellationToken);
            results.Add(new CheckStep(name, result.ExitCode == 0 && !result.TimedOut, Math.Round(clock.Elapsed.TotalSeconds, 1), OutputText.Truncate(result.Combined, 3000)));
        }

        return results;
    }

    private async Task WriteLogAsync(string id, IReadOnlyList<RunEvent> events, CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(resultsDirectory);
        var lines = events.Select(e => new JsonObject { ["seq"] = e.Seq, ["type"] = e.Type, ["payload"] = e.Payload.DeepClone() }.ToJsonString(Json.Compact));
        await File.WriteAllLinesAsync(Path.Combine(resultsDirectory, id + ".jsonl"), lines, cancellationToken);
    }

    public static string Money(decimal usd) => usd.ToString("0.0000", CultureInfo.InvariantCulture);
}
