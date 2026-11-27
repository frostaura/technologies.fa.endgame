using System.Collections.Concurrent;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Endgame.Harness;
using Endgame.Harness.Events;
using Endgame.Harness.Model;
using Endgame.Harness.Tools;
using Endgame.Harness.Workspaces;

namespace Endgame.Tests.Harness;

/// <summary>
/// A model that answers from a script: each step is a function of the call, so a test can assert on
/// what the harness sent (messages, tools, pinning, cache marks) and steer what comes back.
/// </summary>
public sealed class ScriptedModel : IModelClient
{
    private readonly ConcurrentQueue<Func<ChatCall, ModelReply>> script = new();

    public List<ChatCall> Calls { get; } = [];

    /// <summary>Answers for summary calls (task type "summarise"), kept apart from the main script.</summary>
    public Func<ChatCall, ModelReply>? Summariser { get; set; }

    /// <summary>When the script is empty: the reply used (default: a final "Done.").</summary>
    public Func<ChatCall, ModelReply> Fallback { get; set; } = _ => Text("Done.");

    public ScriptedModel Then(Func<ChatCall, ModelReply> step)
    {
        script.Enqueue(step);
        return this;
    }

    public ScriptedModel ThenTool(string name, object arguments, string? id = null) => Then(_ => Tools((name, arguments, id)));

    public ScriptedModel ThenText(string text) => Then(_ => Text(text));

    public ScriptedModel ThenFail(ModelFailure failure) => Then(_ => throw new ModelCallException(failure, $"scripted {failure}"));

    public Task<ModelReply> CompleteAsync(ChatCall call, CancellationToken cancellationToken)
    {
        lock (Calls)
        {
            Calls.Add(call);
        }

        if (call.TaskType == "summarise" && Summariser is { } summarise)
        {
            return Task.FromResult(summarise(call));
        }

        return Task.FromResult(script.TryDequeue(out var step) ? step(call) : Fallback(call));
    }

    public static ModelReply Text(string text, decimal credits = 0.01m, string provider = "ProviderA", string model = "deepseek/deepseek-v4.1-flash") =>
        Reply(new JsonObject { ["role"] = "assistant", ["content"] = text }, credits, provider, model);

    public static ModelReply Tools(params (string Name, object Arguments, string? Id)[] calls) =>
        Reply(new JsonObject
        {
            ["role"] = "assistant",
            ["content"] = "",
            ["reasoning"] = "thinking about it",
            ["reasoning_details"] = new JsonArray(new JsonObject { ["type"] = "reasoning.text", ["text"] = "thinking about it", ["index"] = 0 }),
            ["tool_calls"] = new JsonArray(calls.Select((c, i) => (JsonNode)new JsonObject
            {
                ["id"] = c.Id ?? $"tc_{Guid.NewGuid():N}"[..14],
                ["type"] = "function",
                ["function"] = new JsonObject
                {
                    ["name"] = c.Name,
                    ["arguments"] = c.Arguments is string s ? s : System.Text.Json.JsonSerializer.Serialize(c.Arguments),
                },
            }).ToArray()),
        }, 0.01m, "ProviderA", "deepseek/deepseek-v4.1-flash");

    public static ModelReply Reply(JsonObject message, decimal credits, string provider, string model) =>
        new(message, message["tool_calls"] is null ? "stop" : "tool_calls", model, provider, 100, 20, 0, credits * 10, credits, true);
}

/// <summary>
/// A workspace in memory: files as bytes, and a small command interpreter for what the tools run
/// (find, rg, base64 reads) plus a handler a test can set for anything else.
/// </summary>
public sealed class FakeWorkspace : IWorkspace
{
    public string Root => "/workspace";

    public ConcurrentDictionary<string, byte[]> Files { get; } = new(StringComparer.Ordinal);

    public List<WorkspaceCommand> Commands { get; } = [];

    public List<string> CommitMessages { get; } = [];

    /// <summary>Each time a run asked for this workspace: for which app, and where it was to start (R9-1).</summary>
    public List<(Guid AppId, string? StartFrom)> Ensured { get; } = [];

    /// <summary>Who each commit was authored by, with Dock's own rule applied: no angle brackets or line breaks.</summary>
    public List<string> CommitAuthors { get; } = [];

    /// <summary>Shell lines and argument vectors the interpreter does not know go here.</summary>
    public Func<WorkspaceCommand, WorkspaceExec> Shell { get; set; } = _ => Ok("");

    public FakeWorkspace With(string relative, string text)
    {
        Files[$"{Root}/{relative}"] = Encoding.UTF8.GetBytes(text);
        return this;
    }

    public string Text(string relative) => Encoding.UTF8.GetString(Files[$"{Root}/{relative}"]);

    public Task<byte[]?> ReadBytesAsync(string absolutePath, CancellationToken cancellationToken) =>
        Task.FromResult(Files.TryGetValue(absolutePath, out var bytes) ? bytes.ToArray() : null);

    public Task WriteBytesAsync(string absolutePath, byte[] content, CancellationToken cancellationToken)
    {
        if (absolutePath.Contains("/.git/", StringComparison.Ordinal))
        {
            throw new WorkspaceException("Paths inside .git are protected.", "protected_path");
        }

        Files[absolutePath] = content.ToArray();
        return Task.CompletedTask;
    }

    public Task<WorkspaceExec> ExecAsync(WorkspaceCommand command, CancellationToken cancellationToken)
    {
        lock (Commands)
        {
            Commands.Add(command);
        }

        if (command.Argv is ["find", var dir, ..])
        {
            var files = Files.Keys.Where(f => f.StartsWith(dir == Root ? Root + "/" : dir + "/", StringComparison.Ordinal) && !f.Contains("/node_modules/", StringComparison.Ordinal)).Order(StringComparer.Ordinal);
            return Task.FromResult(Ok(string.Join('\n', files) + "\n"));
        }

        if (command.Argv is ["rg", ..] argv)
        {
            var pattern = argv[argv.ToList().IndexOf("-e") + 1];
            var regex = new Regex(pattern);
            var hits = new StringBuilder();
            foreach (var (path, bytes) in Files.OrderBy(f => f.Key, StringComparer.Ordinal))
            {
                var lines = Encoding.UTF8.GetString(bytes).Split('\n');
                for (var i = 0; i < lines.Length; i++)
                {
                    if (regex.IsMatch(lines[i]))
                    {
                        hits.Append(path).Append(':').Append(i + 1).Append(':').Append(lines[i]).Append('\n');
                    }
                }
            }

            return Task.FromResult(hits.Length == 0 ? new WorkspaceExec(1, "", "", false, false, 1) : Ok(hits.ToString()));
        }

        return Task.FromResult(Shell(command));
    }

    public Task<WorkspaceCommit> CommitAsync(string message, string authorName, string authorEmail, CancellationToken cancellationToken)
    {
        if (authorName.Length == 0 || authorName.IndexOfAny(['<', '>', '\n', '\r']) >= 0)
        {
            throw new WorkspaceException("An author name is required, without angle brackets or line breaks.", "bad_request");
        }

        CommitAuthors.Add(authorName);
        CommitMessages.Add(message);
        return Task.FromResult(new WorkspaceCommit($"c{CommitMessages.Count:D3}0000000000000000", true));
    }

    public static WorkspaceExec Ok(string stdout) => new(0, stdout, "", false, false, 5);

    public static WorkspaceExec Fail(int code, string output) => new(code, output, "", false, false, 5);
}

/// <summary>Builds agents for tests with sensible defaults.</summary>
public static class TestAgents
{
    public static readonly ITool[] WorkspaceTools =
    [
        new ReadFileTool(), new EditFileTool(), new WriteFileTool(), new ListFilesTool(), new SearchTool(), new RunTool(), new GitDiffTool(), new CommitTool(),
    ];

    public static AgentDefinition Builder(IEnumerable<ITool>? tools = null, Func<AgentDefinition, AgentDefinition>? change = null)
    {
        var agent = new AgentDefinition
        {
            TaskType = "build",
            Scope = "frostaura/technologies/endgame",
            RunId = Guid.NewGuid(),
            SystemPrompt = "You are a test agent.",
            Tools = new ToolRegistry(tools ?? WorkspaceTools),
            Permissions = new Endgame.Harness.Permissions.PermissionPolicy
            {
                Allow = [.. new[] { "edit_file", "write_file", "run", "commit", "tasks" }.Select(Endgame.Harness.Permissions.PermissionRule.Parse)],
            },
        };
        return change is null ? agent : change(agent);
    }

    public static AgentServices Services(IModelClient model) => new()
    {
        Model = model,
        Retry = new RetryPolicy(4, TimeSpan.Zero, (_, _) => Task.CompletedTask),
    };

    public static async Task<(AgentResult Result, InMemoryRunLog Log)> RunAsync(AgentDefinition agent, IModelClient model, IWorkspace workspace, string task = "Do the task.", AgentServices? services = null)
    {
        var log = new InMemoryRunLog();
        var loop = new AgentLoop(agent, services ?? Services(model), workspace, log);
        var result = await loop.StartAsync(task, CancellationToken.None);
        return (result, log);
    }

    public static IReadOnlyList<string> Types(this InMemoryRunLog log) => log.Events.Select(e => e.Type).ToList();
}
