using System.Text;
using System.Text.Json.Nodes;
using Endgame.Harness.Events;
using Endgame.Harness.Kernel;
using Endgame.Harness.Tools;

namespace Endgame.Harness.Skills;

/// <summary>A packaged procedure: only its name and one-line trigger sit in context until it is loaded.</summary>
public sealed record Skill(string Name, string Trigger, string Body);

public interface ISkillLibrary
{
    IReadOnlyList<Skill> All { get; }

    Skill? Find(string name);
}

/// <summary>
/// Skills read from markdown files with a front matter of <c>name:</c> and <c>trigger:</c> (the build
/// plan's part 9). Loaded once; a file without both keys is refused when the library is built, so a
/// broken skill never reaches an agent.
/// </summary>
public sealed class SkillLibrary : ISkillLibrary
{
    private readonly Dictionary<string, Skill> skills;

    public SkillLibrary(IEnumerable<Skill> skills)
    {
        ArgumentNullException.ThrowIfNull(skills);
        this.skills = skills.ToDictionary(s => s.Name, StringComparer.Ordinal);
    }

    public IReadOnlyList<Skill> All => skills.Values.OrderBy(s => s.Name, StringComparer.Ordinal).ToList();

    public Skill? Find(string name) => skills.GetValueOrDefault(name);

    public static SkillLibrary FromDirectory(string directory)
    {
        if (!Directory.Exists(directory))
        {
            throw new DirectoryNotFoundException($"The skills directory '{directory}' does not exist.");
        }

        return new SkillLibrary(Directory.EnumerateFiles(directory, "*.md", SearchOption.TopDirectoryOnly).Order(StringComparer.Ordinal).Select(f => Parse(File.ReadAllText(f), Path.GetFileName(f))));
    }

    public static Skill Parse(string text, string source)
    {
        ArgumentNullException.ThrowIfNull(text);
        var normalised = text.Replace("\r\n", "\n", StringComparison.Ordinal);
        if (!normalised.StartsWith("---\n", StringComparison.Ordinal))
        {
            throw new FormatException($"{source}: a skill starts with front matter (---, name:, trigger:, ---).");
        }

        var end = normalised.IndexOf("\n---\n", 4, StringComparison.Ordinal);
        if (end < 0)
        {
            throw new FormatException($"{source}: the front matter is not closed with ---.");
        }

        var fields = normalised[4..end].Split('\n')
            .Select(l => l.Split(':', 2))
            .Where(p => p.Length == 2)
            .ToDictionary(p => p[0].Trim(), p => p[1].Trim(), StringComparer.Ordinal);
        if (!fields.TryGetValue("name", out var name) || name.Length == 0 || !fields.TryGetValue("trigger", out var trigger) || trigger.Length == 0)
        {
            throw new FormatException($"{source}: a skill needs both name: and trigger:.");
        }

        return new Skill(name, trigger, normalised[(end + 5)..].Trim());
    }

    /// <summary>The lines that sit in the system prompt: a name and a trigger per skill.</summary>
    public static string Index(ISkillLibrary? library, IEnumerable<string>? only = null)
    {
        if (library is null || library.All.Count == 0)
        {
            return "";
        }

        var allowed = only?.ToHashSet(StringComparer.Ordinal);
        var sb = new StringBuilder("Skills — procedures you can load with load_skill when one fits the work:\n");
        foreach (var skill in library.All.Where(s => allowed is null || allowed.Contains(s.Name)))
        {
            sb.Append("- ").Append(skill.Name).Append(": ").Append(skill.Trigger).Append('\n');
        }

        return sb.ToString();
    }
}

/// <summary><c>load_skill</c>: brings a skill's body into context on demand.</summary>
public sealed class LoadSkillTool : ITool
{
    public string Name => "load_skill";

    public string Description => "Load a skill (a packaged procedure listed in your instructions) by name, to follow it.";

    public JsonObject Parameters => Schema.Object(new JsonObject { ["name"] = Schema.Str("The skill's name.") }, "name");

    public ToolEffect Effect => ToolEffect.ReadOnly;

    public (ToolTargets Targets, string? Error) Target(JsonObject arguments, string root) => (ToolTargets.None, null);

    public Task<ToolOutcome> ExecuteAsync(ToolCall call, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(call);
        var library = call.Context.Services.Skills;
        var name = Json.Str(call.Arguments, "name") ?? "";
        if (library?.Find(name) is not { } skill)
        {
            var known = library?.All.Select(s => s.Name) ?? [];
            return Task.FromResult(ToolOutcome.Error($"There is no skill called '{name}'. Skills: {string.Join(", ", known)}.", "not_found"));
        }

        call.Context.State.LoadedSkills.Add(skill.Name);
        return Task.FromResult(new ToolOutcome($"# Skill: {skill.Name}\n\n{skill.Body}"));
    }
}

/// <summary>
/// <c>notes</c>: a notes file kept outside the context (the build plan's part 7). Notes survive
/// compaction; each one is an event, so they survive a crash too.
/// </summary>
public sealed class NotesTool : ITool
{
    public const int MaxNotes = 200;

    public string Name => "notes";

    public string Description => "Your notes, kept outside the conversation so they survive when it is summarised: append decisions, findings and what is left to do; read them back when you need them.";

    public JsonObject Parameters => Schema.Object(new JsonObject
    {
        ["action"] = Schema.Enum("append or read.", "append", "read"),
        ["text"] = Schema.Str("For append: the note."),
    }, "action");

    public ToolEffect Effect => ToolEffect.ReadOnly;

    public (ToolTargets Targets, string? Error) Target(JsonObject arguments, string root) => (ToolTargets.None, null);

    public async Task<ToolOutcome> ExecuteAsync(ToolCall call, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(call);
        var notes = call.Context.State.Notes;
        if (Json.Str(call.Arguments, "action") == "append")
        {
            var text = Json.Str(call.Arguments, "text")?.Trim();
            if (string.IsNullOrEmpty(text))
            {
                return ToolOutcome.Error("notes append needs text.", "bad_arguments");
            }

            if (notes.Count >= MaxNotes)
            {
                return ToolOutcome.Error($"There are already {MaxNotes} notes; read them and keep only what matters in a new one.", "bad_arguments");
            }

            var note = OutputText.Truncate(text, 4000);
            notes.Add(note);
            await call.Context.Events.WriteAsync(HarnessEvents.Message, new JsonObject { ["kind"] = "notes", ["note"] = note }, cancellationToken);
            return new ToolOutcome($"Noted ({notes.Count} note{(notes.Count == 1 ? "" : "s")}).");
        }

        return new ToolOutcome(notes.Count == 0 ? "No notes yet." : string.Join("\n", notes.Select((n, i) => $"{i + 1}. {n}")));
    }
}
