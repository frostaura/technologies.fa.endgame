using System.Text;
using System.Text.Json.Nodes;
using Endgame.Harness;
using Endgame.Harness.Events;
using Endgame.Harness.Tools;
using Endgame.Harness.Workspaces;

namespace Endgame.Tests.Harness;

/// <summary>The edit contract of ARCH-006, every failure path, and each workspace tool through a fake workspace.</summary>
public sealed class ToolTests
{
    private const string Source = "public class A\n{\n    public int X { get; set; }\n    public int Y { get; set; }\n}\n";

    [Fact]
    public void An_exact_unique_match_is_replaced_and_the_line_reported()
    {
        var result = EditEngine.Apply(Source, "    public int Y { get; set; }", "    public int Z { get; set; }", false, "A.cs");
        Assert.True(result.Ok);
        Assert.Contains("public int Z", result.Content, StringComparison.Ordinal);
        Assert.DoesNotContain("public int Y", result.Content, StringComparison.Ordinal);
        Assert.Equal(4, result.FirstLine);
        Assert.Equal("Edited A.cs: replaced 1 occurrence at line 4.", result.Message);
    }

    [Fact]
    public void Not_unique_says_how_many_times_and_on_which_lines_and_changes_nothing()
    {
        var result = EditEngine.Apply(Source, "{ get; set; }", "{ get; init; }", false, "A.cs");
        Assert.False(result.Ok);
        Assert.Null(result.Content);
        Assert.Contains("occurs 2 times in A.cs (starting on lines 3, 4)", result.Message, StringComparison.Ordinal);
        Assert.Contains("replace_all", result.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Replace_all_changes_every_occurrence()
    {
        var result = EditEngine.Apply(Source, "{ get; set; }", "{ get; init; }", true, "A.cs");
        Assert.True(result.Ok);
        Assert.Equal(2, result.Replaced);
        Assert.Equal(2, EditEngine.Count(result.Content!, "init;"));
    }

    [Fact]
    public void Not_found_but_equal_ignoring_whitespace_quotes_the_files_real_text()
    {
        var result = EditEngine.Apply(Source, "  public  int X {  get;   set; }", "public int X { get; }", false, "A.cs");
        Assert.False(result.Ok);
        Assert.Contains("matches lines 3-3 if whitespace is ignored", result.Message, StringComparison.Ordinal);
        Assert.Contains("    public int X { get; set; }", result.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Not_found_with_its_first_line_present_points_at_that_line()
    {
        var result = EditEngine.Apply(Source, "    public int X { get; set; }\n    public int W { get; set; }", "x", false, "A.cs");
        Assert.False(result.Ok);
        Assert.Contains("first line does appear at line 3", result.Message, StringComparison.Ordinal);
        Assert.Contains("The file there reads:", result.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Not_found_at_all_says_the_file_may_have_changed()
    {
        var result = EditEngine.Apply(Source, "class Missing", "x", false, "A.cs");
        Assert.False(result.Ok);
        Assert.Contains("Even its first line does not appear", result.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void A_pasted_line_number_prefix_is_diagnosed()
    {
        var result = EditEngine.Apply(Source, "    3\t    public int X { get; set; }", "x", false, "A.cs");
        Assert.False(result.Ok);
        Assert.Contains("line-number prefixes", result.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Identical_old_and_new_is_refused()
    {
        var result = EditEngine.Apply(Source, "class A", "class A", false, "A.cs");
        Assert.False(result.Ok);
        Assert.Contains("identical", result.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void An_empty_old_string_points_to_write_file()
    {
        var result = EditEngine.Apply(Source, "", "x", false, "A.cs");
        Assert.False(result.Ok);
        Assert.Contains("use write_file", result.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Missing_arguments_are_refused()
    {
        Assert.False(EditEngine.Apply(Source, null, "x", false, "A.cs").Ok);
        Assert.False(EditEngine.Apply(Source, "x", null, false, "A.cs").Ok);
    }

    [Fact]
    public void Windows_line_endings_from_the_model_match_a_unix_file()
    {
        var result = EditEngine.Apply(Source, "{\r\n    public int X", "{\r\n    public long X", false, "A.cs");
        Assert.True(result.Ok);
        Assert.Contains("{\n    public long X", result.Content, StringComparison.Ordinal);
        Assert.DoesNotContain('\r', result.Content!);
    }

    [Fact]
    public void Unix_line_endings_from_the_model_match_a_windows_file_and_keep_its_endings()
    {
        var crlf = Source.Replace("\n", "\r\n", StringComparison.Ordinal);
        var result = EditEngine.Apply(crlf, "{\n    public int X", "{\n    public long X\n    // added", false, "A.cs");
        Assert.True(result.Ok);
        Assert.Contains("{\r\n    public long X\r\n    // added", result.Content, StringComparison.Ordinal);
        Assert.Equal(0, EditEngine.Count(result.Content!.Replace("\r\n", "", StringComparison.Ordinal), "\n"));
    }

    [Fact]
    public async Task Edit_file_through_the_workspace_keeps_a_byte_order_mark_and_says_when_the_file_is_missing()
    {
        var ws = new FakeWorkspace();
        ws.Files["/workspace/A.cs"] = [0xEF, 0xBB, 0xBF, .. Encoding.UTF8.GetBytes(Source)];
        var edit = await Call(new EditFileTool(), ws, new { path = "A.cs", old_string = "int X", new_string = "long X" });
        Assert.False(edit.IsError);
        Assert.Equal(new byte[] { 0xEF, 0xBB, 0xBF }, ws.Files["/workspace/A.cs"][..3]);
        Assert.Contains("long X", Encoding.UTF8.GetString(ws.Files["/workspace/A.cs"]), StringComparison.Ordinal);

        var missing = await Call(new EditFileTool(), ws, new { path = "B.cs", old_string = "a", new_string = "b" });
        Assert.True(missing.IsError);
        Assert.Equal("edit_failed", missing.ErrorKind);
        Assert.Contains("Use write_file to create it", missing.Content, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Read_file_numbers_lines_says_they_are_not_part_of_the_file_and_pages_with_the_next_offset()
    {
        var ws = new FakeWorkspace().With("long.txt", string.Join('\n', Enumerable.Range(1, 30).Select(i => $"line {i}")) + "\n");
        var page = await Call(new ReadFileTool(), ws, new { path = "long.txt", offset = 5, limit = 10 });
        Assert.StartsWith("    5\tline 5\n", page.Content, StringComparison.Ordinal);
        Assert.Contains("   14\tline 14\n", page.Content, StringComparison.Ordinal);
        Assert.DoesNotContain("line 15", page.Content, StringComparison.Ordinal);
        Assert.Contains("(16 more lines; call read_file with offset=15 to continue)", page.Content, StringComparison.Ordinal);
        Assert.Contains("NOT part of the file", new ReadFileTool().Description, StringComparison.Ordinal);

        var past = await Call(new ReadFileTool(), ws, new { path = "long.txt", offset = 99 });
        Assert.True(past.IsError);
        var missing = await Call(new ReadFileTool(), ws, new { path = "nope.txt" });
        Assert.Equal("not_found", missing.ErrorKind);
    }

    [Fact]
    public async Task Write_file_creates_a_file_and_keeps_an_existing_files_line_endings()
    {
        var ws = new FakeWorkspace();
        var created = await Call(new WriteFileTool(), ws, new { path = "src/new.ts", content = "a\nb\n" });
        Assert.Equal("Created src/new.ts (2 lines).", created.Content);
        ws.Files["/workspace/win.txt"] = Encoding.UTF8.GetBytes("x\r\ny\r\n");
        await Call(new WriteFileTool(), ws, new { path = "win.txt", content = "p\nq\n" });
        Assert.Equal("p\r\nq\r\n", ws.Text("win.txt"));
    }

    [Fact]
    public void A_path_outside_the_workspace_gets_an_error_that_names_the_fix()
    {
        var (path, error) = WorkspacePath.Resolve("/src/App.cs", "/workspace");
        Assert.Null(path);
        Assert.Contains("drop the leading slash (\"src/App.cs\")", error, StringComparison.Ordinal);
        Assert.Null(WorkspacePath.Resolve("../../etc/passwd", "/workspace").Path);
        Assert.Equal("src/App.cs", WorkspacePath.Resolve("/workspace/src/./x/../App.cs", "/workspace").Path!.Relative);
        Assert.True(WorkspacePath.Resolve(".git/config", "/workspace").Path!.IsInsideGit);
    }

    [Fact]
    public async Task Run_keeps_the_head_and_the_tail_of_long_output_and_strips_colour()
    {
        var ws = new FakeWorkspace
        {
            Shell = _ => FakeWorkspace.Fail(1, "\u001b[31mSTART\u001b[0m\n" + new string('x', 50_000) + "\nerror CS1002: ; expected at the END"),
        };
        var result = await Call(new RunTool(), ws, new { command = "dotnet build" });
        Assert.StartsWith("[exit code 1]\nSTART", result.Content, StringComparison.Ordinal);
        Assert.EndsWith("error CS1002: ; expected at the END", result.Content, StringComparison.Ordinal);
        Assert.Contains("characters cut", result.Content, StringComparison.Ordinal);
        Assert.DoesNotContain('\u001b', result.Content);
        Assert.True(result.Content.Length < RunTool.MaxOutput + 200);
        Assert.Equal("exec 2>&1; dotnet build", ws.Commands.Single().Shell);
    }

    [Fact]
    public async Task List_files_and_search_report_relative_paths()
    {
        var ws = new FakeWorkspace().With("api/Program.cs", "var app = 1;\n").With("web/src/App.tsx", "export const App = 1;\n");
        var list = await Call(new ListFilesTool(), ws, new { });
        Assert.Equal("api/Program.cs\nweb/src/App.tsx", list.Content);
        var search = await Call(new SearchTool(), ws, new { pattern = "App =" });
        Assert.Equal("web/src/App.tsx:1:export const App = 1;\n", search.Content);
        var none = await Call(new SearchTool(), ws, new { pattern = "nothing-here" });
        Assert.Equal("No matches.", none.Content);
    }

    [Fact]
    public async Task Commit_records_the_commit_with_the_agents_author()
    {
        var ws = new FakeWorkspace();
        var result = await Call(new CommitTool(), ws, new { message = "Add notes" });
        Assert.StartsWith("Committed c001", result.Content, StringComparison.Ordinal);
        Assert.Equal(["Add notes"], ws.CommitMessages);
    }

    [Fact]
    public void Output_truncation_keeps_a_third_from_the_head_and_two_thirds_from_the_tail()
    {
        var text = new string('h', 600) + new string('t', 600);
        var cut = OutputTextOf(text, 300);
        Assert.StartsWith(new string('h', 100), cut, StringComparison.Ordinal);
        Assert.EndsWith(new string('t', 200), cut, StringComparison.Ordinal);
    }

    private static string OutputTextOf(string text, int max) => Endgame.Harness.Kernel.OutputText.Truncate(text, max);

    internal static async Task<ToolOutcome> Call(ITool tool, IWorkspace ws, object arguments)
    {
        var args = JsonNode.Parse(System.Text.Json.JsonSerializer.Serialize(arguments))!.AsObject();
        var (_, error) = tool.Target(args, ws.Root);
        Assert.Null(error);
        var context = new ToolContext(ws, new AgentState(), TestAgents.Services(new ScriptedModel()), new AgentEventWriter(new InMemoryRunLog(), "main"), TestAgents.Builder());
        return await tool.ExecuteAsync(new ToolCall("call-1", tool.Name, args, context), CancellationToken.None);
    }
}
