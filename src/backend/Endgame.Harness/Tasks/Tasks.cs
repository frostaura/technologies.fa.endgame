using System.Globalization;
using System.Text.Json.Nodes;
using Endgame.Harness.Kernel;
using Endgame.Harness.Tools;

namespace Endgame.Harness.Tasks;

/// <summary>A task in the persistent graph, as the control plane reports it.</summary>
public sealed record TaskInfo(Guid Id, string Title, string Status, Guid? HolderRunId, decimal? EstimateCredits);

/// <summary>The task graph's answer when a checkout lost the race.</summary>
public sealed class TaskConflictException(string message, TaskInfo? current) : Exception(message)
{
    public TaskInfo? Current { get; } = current;
}

/// <summary>
/// The persistent task graph (the build plan's part 5) over the control plane: create, claim by
/// atomic checkout (one conditional update on expected status and holder), complete, fail.
/// </summary>
public interface ITaskBoard
{
    Task<TaskInfo> CreateAsync(string title, string? description, decimal? estimateCredits, IReadOnlyList<Guid>? dependsOn, CancellationToken cancellationToken);

    /// <summary>Claims a task for the run. Throws <see cref="TaskConflictException"/> when another holder has it.</summary>
    Task<TaskInfo> CheckoutAsync(Guid taskId, string expectedStatus, Guid? expectedHolderRunId, CancellationToken cancellationToken);

    Task<TaskInfo> FinishAsync(Guid taskId, string status, string summary, decimal? actualCredits, CancellationToken cancellationToken);
}

/// <summary><c>tasks</c>: the agent's view of the task graph.</summary>
public sealed class TasksTool : ITool
{
    public string Name => "tasks";

    public string Description => "Work with the persistent task graph: create a task (with what it depends on), claim one (only if nobody else holds it), complete or fail one you hold, or list the tasks this session knows.";

    public JsonObject Parameters => Schema.Object(new JsonObject
    {
        ["action"] = Schema.Enum("What to do.", "create", "claim", "complete", "fail", "list"),
        ["title"] = Schema.Str("create: the task's title, in plain words for the owner (no file names, endpoints or code)."),
        ["description"] = Schema.Str("create: what done means."),
        ["depends_on"] = Schema.Strings("create: ids of tasks that must be done first."),
        ["id"] = Schema.Str("claim, complete, fail: the task id."),
        ["summary"] = Schema.Str("complete, fail: what was done, or why it failed."),
    }, "action");

    public ToolEffect Effect => ToolEffect.External;

    public (ToolTargets Targets, string? Error) Target(JsonObject arguments, string root) => (ToolTargets.None, null);

    public async Task<ToolOutcome> ExecuteAsync(ToolCall call, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(call);
        var board = call.Context.Services.Tasks;
        var known = call.Context.State.Tasks;
        var action = Json.Str(call.Arguments, "action");
        if (action == "list")
        {
            return new ToolOutcome(known.Count == 0 ? "No tasks yet." : string.Join('\n', known.Values.Select(Line)));
        }

        if (board is null)
        {
            return ToolOutcome.Error("This run has no task graph.", "unavailable");
        }

        try
        {
            switch (action)
            {
                case "create":
                    var title = Json.Str(call.Arguments, "title")?.Trim();
                    if (string.IsNullOrEmpty(title))
                    {
                        return ToolOutcome.Error("tasks create needs a title.", "bad_arguments");
                    }

                    if (Events.OwnerText.Technical(title) is { Count: > 0 } technical)
                    {
                        return ToolOutcome.Error($"The owner reads a task's title, so it is plain words: it names {string.Join(", ", technical.Take(3))}. Say what the task achieves, and put files, commands and endpoints in description.", "bad_arguments");
                    }

                    var depends = new List<Guid>();
                    foreach (var raw in Json.Strings(call.Arguments, "depends_on"))
                    {
                        if (!Guid.TryParse(raw, out var dep))
                        {
                            return ToolOutcome.Error($"'{raw}' is not a task id.", "bad_arguments");
                        }

                        depends.Add(dep);
                    }

                    var created = await board.CreateAsync(title, Json.Str(call.Arguments, "description"), null, depends, cancellationToken);
                    known[created.Id] = created;
                    return new ToolOutcome($"Created {Line(created)}");
                case "claim" or "complete" or "fail":
                    if (!Guid.TryParse(Json.Str(call.Arguments, "id"), out var id))
                    {
                        return ToolOutcome.Error("Give the task's id.", "bad_arguments");
                    }

                    TaskInfo task;
                    if (action == "claim")
                    {
                        task = await board.CheckoutAsync(id, "todo", null, cancellationToken);
                    }
                    else
                    {
                        var summary = Json.Str(call.Arguments, "summary") ?? "";
                        task = await board.FinishAsync(id, action == "complete" ? "done" : "failed", summary, null, cancellationToken);
                    }

                    known[task.Id] = task;
                    return new ToolOutcome(action switch { "claim" => "Claimed ", "complete" => "Completed ", _ => "Failed " } + Line(task));
                default:
                    return ToolOutcome.Error("action is one of create, claim, complete, fail, list.", "bad_arguments");
            }
        }
        catch (TaskConflictException e)
        {
            return ToolOutcome.Error($"{e.Message}{(e.Current is { } c ? $" It is {c.Status}{(c.HolderRunId is { } h ? $", held by run {h}" : "")}." : "")} Pick another task.", "conflict");
        }
    }

    private static string Line(TaskInfo t) =>
        string.Create(CultureInfo.InvariantCulture, $"{t.Id} [{t.Status}] {t.Title}{(t.EstimateCredits is { } e ? $" (estimate {e} credits)" : "")}");
}
