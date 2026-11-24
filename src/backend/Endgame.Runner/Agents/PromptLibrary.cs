using System.Reflection;
using System.Text.RegularExpressions;
using Endgame.Harness.Skills;
using Endgame.Harness.Workspaces;

namespace Endgame.Runner.Agents;

/// <summary>
/// The agents' prompts and the builders' skills, compiled into the Runner as resources (from
/// <c>Prompts/*.md</c> and <c>Skills/*.md</c>), so the Runner never runs with a missing one.
/// </summary>
public static partial class RunnerResources
{
    private static readonly Assembly Self = typeof(RunnerResources).Assembly;

    public static string Prompt(string name, IReadOnlyDictionary<string, string>? values = null)
    {
        var text = Read($"Prompts.{name}.md") ?? throw new InvalidOperationException($"There is no prompt called '{name}'.");
        text = Placeholder().Replace(text, m => values is not null && values.TryGetValue(m.Groups[1].Value, out var v) ? v : "");
        return text.Trim() + "\n";
    }

    public static SkillLibrary Skills() =>
        new(Self.GetManifestResourceNames()
            .Where(n => n.Contains(".Skills.", StringComparison.Ordinal) && n.EndsWith(".md", StringComparison.Ordinal))
            .Order(StringComparer.Ordinal)
            .Select(n => SkillLibrary.Parse(ReadResource(n), n)));

    private static string? Read(string suffix) =>
        Self.GetManifestResourceNames().FirstOrDefault(n => n.EndsWith("." + suffix, StringComparison.Ordinal) || n.EndsWith(suffix, StringComparison.Ordinal)) is { } name ? ReadResource(name) : null;

    private static string ReadResource(string name)
    {
        using var stream = Self.GetManifestResourceStream(name)!;
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }

    [GeneratedRegex(@"\{\{([a-z]+)\}\}")]
    private static partial Regex Placeholder();
}

/// <summary>
/// The workspace of a run that has no app to work in (research, a conversation): every call is
/// refused with a message saying so. Such agents are given no workspace tools, so this is the floor
/// behind that, not something they are expected to reach.
/// </summary>
public sealed class NoWorkspace : IWorkspace
{
    public static readonly NoWorkspace Instance = new();

    public string Root => "/workspace";

    public Task<byte[]?> ReadBytesAsync(string absolutePath, CancellationToken cancellationToken) => throw Refusal();

    public Task WriteBytesAsync(string absolutePath, byte[] content, CancellationToken cancellationToken) => throw Refusal();

    public Task<WorkspaceExec> ExecAsync(WorkspaceCommand command, CancellationToken cancellationToken) => throw Refusal();

    public Task<WorkspaceCommit> CommitAsync(string message, string authorName, string authorEmail, CancellationToken cancellationToken) => throw Refusal();

    private static WorkspaceException Refusal() => new("This run has no workspace: it works on no app's code.", "no_workspace");
}
