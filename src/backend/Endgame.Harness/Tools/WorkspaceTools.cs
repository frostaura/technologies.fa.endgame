using System.Globalization;
using System.Text;
using System.Text.Json.Nodes;
using Endgame.Harness.Kernel;
using Endgame.Harness.Workspaces;

namespace Endgame.Harness.Tools;

/// <summary>Shared targeting for tools that take one path argument.</summary>
public abstract class PathTool(string pathArgument = "path", bool allowRoot = false) : ITool
{
    public abstract string Name { get; }

    public abstract string Description { get; }

    public abstract JsonObject Parameters { get; }

    public abstract ToolEffect Effect { get; }

    public (ToolTargets Targets, string? Error) Target(JsonObject arguments, string root)
    {
        var (path, error) = WorkspacePath.Resolve(Json.Str(arguments, pathArgument), root, allowRoot);
        return path is null ? (ToolTargets.None, error) : (new ToolTargets([path], null), null);
    }

    public abstract Task<ToolOutcome> ExecuteAsync(ToolCall call, CancellationToken cancellationToken);

    protected WorkspacePath PathOf(ToolCall call) =>
        WorkspacePath.Resolve(Json.Str(call.Arguments, pathArgument), call.Context.Workspace.Root, allowRoot).Path
        ?? throw new InvalidOperationException("The permission check resolves the path before a tool runs.");
}

/// <summary><c>read_file</c>: numbered lines that say they are not part of the file, paged with a footer naming the next offset.</summary>
public sealed class ReadFileTool : PathTool
{
    public const int DefaultLimit = 400;
    public const int MaxChars = 40_000;

    public override string Name => "read_file";

    public override string Description =>
        "Read a text file. Each line is shown as its number, a tab, then the text: the number and tab are NOT part of the file, never copy them into edit_file. Long files are paged: pass offset and limit to read more.";

    public override JsonObject Parameters => Schema.Object(new JsonObject
    {
        ["path"] = Schema.Str("The file, relative to the repository root (or absolute under the workspace root)."),
        ["offset"] = Schema.Int("The 1-based line to start at (default 1)."),
        ["limit"] = Schema.Int($"How many lines to show (default {DefaultLimit}, at most 2000)."),
    }, "path");

    public override ToolEffect Effect => ToolEffect.ReadOnly;

    public override async Task<ToolOutcome> ExecuteAsync(ToolCall call, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(call);
        var path = PathOf(call);
        var bytes = await call.Context.Workspace.ReadBytesAsync(path.Absolute, cancellationToken);
        if (bytes is null)
        {
            return ToolOutcome.Error($"'{path.Relative}' does not exist or is a directory. Use list_files to see what exists.", "not_found");
        }

        if (FileText.IsBinary(bytes))
        {
            return ToolOutcome.Error($"'{path.Relative}' is a binary file ({bytes.Length} bytes); it cannot be shown as text.", "binary");
        }

        var (text, _) = FileText.Decode(bytes);
        var lines = text.Split('\n');
        if (text.EndsWith('\n'))
        {
            lines = lines[..^1];
        }

        if (text.Length == 0)
        {
            return new ToolOutcome($"{path.Relative} is empty.");
        }

        var offset = Math.Max(1, Json.Int(call.Arguments, "offset") ?? 1);
        var limit = Math.Clamp(Json.Int(call.Arguments, "limit") ?? DefaultLimit, 1, 2000);
        if (offset > lines.Length)
        {
            return ToolOutcome.Error($"offset {offset} is past the end of {path.Relative}, which has {lines.Length} lines.", "bad_arguments");
        }

        var sb = new StringBuilder();
        var end = Math.Min(lines.Length, offset - 1 + limit);
        for (var i = offset - 1; i < end; i++)
        {
            var line = lines[i].TrimEnd('\r');
            if (sb.Length + line.Length > MaxChars)
            {
                end = i;
                break;
            }

            sb.Append((i + 1).ToString(CultureInfo.InvariantCulture).PadLeft(5)).Append('\t').Append(line).Append('\n');
        }

        if (end < lines.Length)
        {
            sb.Append(CultureInfo.InvariantCulture, $"... ({lines.Length - end} more lines; call read_file with offset={end + 1} to continue)\n");
        }

        return new ToolOutcome(sb.ToString());
    }
}

/// <summary><c>edit_file</c>: the ARCH-006 exact-replace contract over <see cref="EditEngine"/>.</summary>
public sealed class EditFileTool : PathTool
{
    public override string Name => "edit_file";

    public override string Description =>
        "Replace an exact piece of text in a file. old_string must match the file exactly (indentation and line breaks included) and occur exactly once, unless replace_all is true. Read the file first, and never include read_file's line-number prefix. Add surrounding lines to make old_string unique. Either the whole edit happens or nothing changes.";

    public override JsonObject Parameters => Schema.Object(new JsonObject
    {
        ["path"] = Schema.Str("The file to change."),
        ["old_string"] = Schema.Str("The exact text to replace."),
        ["new_string"] = Schema.Str("The text to put in its place."),
        ["replace_all"] = Schema.Bool("Replace every occurrence (default false)."),
    }, "path", "old_string", "new_string");

    public override ToolEffect Effect => ToolEffect.WritesFiles;

    public override async Task<ToolOutcome> ExecuteAsync(ToolCall call, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(call);
        var path = PathOf(call);
        var bytes = await call.Context.Workspace.ReadBytesAsync(path.Absolute, cancellationToken);
        if (bytes is null)
        {
            return ToolOutcome.Error($"'{path.Relative}' does not exist. Use write_file to create it.", "edit_failed");
        }

        if (FileText.IsBinary(bytes))
        {
            return ToolOutcome.Error($"'{path.Relative}' is a binary file; edit_file only changes text.", "edit_failed");
        }

        var (text, bom) = FileText.Decode(bytes);
        var result = EditEngine.Apply(text, Json.Str(call.Arguments, "old_string"), Json.Str(call.Arguments, "new_string"), Json.Bool(call.Arguments, "replace_all") ?? false, path.Relative);
        if (!result.Ok)
        {
            return ToolOutcome.Error(result.Message, "edit_failed");
        }

        await call.Context.Workspace.WriteBytesAsync(path.Absolute, FileText.Encode(result.Content!, bom), cancellationToken);
        return new ToolOutcome(result.Message);
    }
}

/// <summary><c>write_file</c>: create a file or replace it whole.</summary>
public sealed class WriteFileTool : PathTool
{
    public override string Name => "write_file";

    public override string Description => "Create a file, or replace one completely, with the given content. Missing directories are created. Prefer edit_file for changes to an existing file.";

    public override JsonObject Parameters => Schema.Object(new JsonObject
    {
        ["path"] = Schema.Str("The file to write."),
        ["content"] = Schema.Str("The whole content of the file."),
    }, "path", "content");

    public override ToolEffect Effect => ToolEffect.WritesFiles;

    public override async Task<ToolOutcome> ExecuteAsync(ToolCall call, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(call);
        var path = PathOf(call);
        var content = Json.Str(call.Arguments, "content");
        if (content is null)
        {
            return ToolOutcome.Error("write_file needs content (the whole file). To empty a file, send an empty string.", "bad_arguments");
        }

        var existing = await call.Context.Workspace.ReadBytesAsync(path.Absolute, cancellationToken);
        var bom = false;
        if (existing is not null && !FileText.IsBinary(existing))
        {
            // Keep the file's own line ending and byte-order mark when it is being replaced.
            var (old, hadBom) = FileText.Decode(existing);
            bom = hadBom;
            content = EditEngine.ToEnding(content, EditEngine.UsesCrlf(old));
        }

        await call.Context.Workspace.WriteBytesAsync(path.Absolute, FileText.Encode(content, bom), cancellationToken);
        var lines = content.Length == 0 ? 0 : content.TrimEnd('\n').Split('\n').Length;
        return new ToolOutcome($"{(existing is null ? "Created" : "Replaced")} {path.Relative} ({lines} line{(lines == 1 ? "" : "s")}).");
    }
}

/// <summary><c>list_files</c>: files under a directory, skipping build output and dependencies.</summary>
public sealed class ListFilesTool() : PathTool(allowRoot: true)
{
    public const int MaxEntries = 500;

    public override string Name => "list_files";

    public override string Description => "List the files under a directory, recursively, skipping bin/, obj/, node_modules/, dist/, wwwroot/ and .git/.";

    public override JsonObject Parameters => Schema.Object(new JsonObject
    {
        ["path"] = Schema.Str("The directory (default: the repository root)."),
        ["max_depth"] = Schema.Int("How deep to go (default 4)."),
    });

    public override ToolEffect Effect => ToolEffect.ReadOnly;

    public override async Task<ToolOutcome> ExecuteAsync(ToolCall call, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(call);
        var path = PathOf(call);
        var depth = Math.Clamp(Json.Int(call.Arguments, "max_depth") ?? 4, 1, 12);
        var root = call.Context.Workspace.Root;
        var result = await call.Context.Workspace.ExecAsync(WorkspaceCommand.Args(
            "find", path.Absolute, "-maxdepth", depth.ToString(CultureInfo.InvariantCulture),
            "(", "-name", "node_modules", "-o", "-name", "bin", "-o", "-name", "obj", "-o", "-name", ".git", "-o", "-name", "dist", "-o", "-name", "wwwroot", ")", "-prune",
            "-o", "-type", "f", "-print"), cancellationToken);
        if (result.ExitCode != 0)
        {
            return ToolOutcome.Error($"'{path.Relative}' could not be listed: {OutputText.Truncate(result.Stderr.Trim(), 500)}", "not_found");
        }

        var files = result.Stdout.Split('\n', StringSplitOptions.RemoveEmptyEntries)
            .Select(f => f == root ? "." : f.StartsWith(root + "/", StringComparison.Ordinal) ? f[(root.Length + 1)..] : f)
            .Order(StringComparer.Ordinal)
            .ToList();
        if (files.Count == 0)
        {
            return new ToolOutcome($"No files under {path.Relative}.");
        }

        var shown = string.Join('\n', files.Take(MaxEntries));
        return new ToolOutcome(files.Count > MaxEntries ? $"{shown}\n... ({files.Count - MaxEntries} more; list a subdirectory to see them)" : shown);
    }
}

/// <summary><c>search</c>: ripgrep over the workspace.</summary>
public sealed class SearchTool() : PathTool(allowRoot: true)
{
    public override string Name => "search";

    public override string Description => "Search file contents with a regular expression (ripgrep syntax). Returns matching lines as path:line:text, at most 50 per file.";

    public override JsonObject Parameters => Schema.Object(new JsonObject
    {
        ["pattern"] = Schema.Str("The regular expression."),
        ["path"] = Schema.Str("A directory or file to search (default: the repository root)."),
        ["glob"] = Schema.Str("Only files matching this glob, for example '*.cs'."),
    }, "pattern");

    public override ToolEffect Effect => ToolEffect.ReadOnly;

    public override async Task<ToolOutcome> ExecuteAsync(ToolCall call, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(call);
        var pattern = Json.Str(call.Arguments, "pattern");
        if (string.IsNullOrEmpty(pattern))
        {
            return ToolOutcome.Error("search needs a pattern.", "bad_arguments");
        }

        var path = PathOf(call);
        var argv = new List<string> { "rg", "-n", "--no-heading", "--color", "never", "-M", "300", "--max-count", "50" };
        if (Json.Str(call.Arguments, "glob") is { Length: > 0 } glob)
        {
            argv.Add("-g");
            argv.Add(glob);
        }

        argv.AddRange(["-e", pattern, "--", path.Absolute]);
        var result = await call.Context.Workspace.ExecAsync(new WorkspaceCommand(argv, null, 60), cancellationToken);
        if (result.ExitCode == 1)
        {
            return new ToolOutcome("No matches.");
        }

        if (result.ExitCode != 0)
        {
            return ToolOutcome.Error($"The search failed: {OutputText.Truncate(result.Stderr.Trim(), 800)}", "tool_error");
        }

        var root = call.Context.Workspace.Root + "/";
        return new ToolOutcome(OutputText.Truncate(result.Stdout.Replace(root, "", StringComparison.Ordinal), RunTool.MaxOutput));
    }
}
