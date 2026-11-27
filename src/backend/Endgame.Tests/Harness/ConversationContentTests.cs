using System.Text.Json.Nodes;
using Endgame.Domain.Credits;
using Endgame.Harness;
using Endgame.Harness.Context;
using Endgame.Harness.Events;
using Endgame.Harness.Kernel;
using Endgame.Harness.Model;
using Endgame.Runner.Agents;
using Endgame.Runner.Execution;
using Endgame.Runner.Workflows;

namespace Endgame.Tests.Harness;

/// <summary>
/// A conversation turn that carries files and narrowings (ARCH-012): the first message as content parts through the kernel,
/// replay and compaction; the turn's files given to the model; "no web search" and "answer only" enforced; and the work a
/// turn started written into its log so the console can follow it.
/// </summary>
public sealed class ConversationContentTests
{
    private static readonly string Photo = Convert.ToBase64String(new byte[300_000]);

    private static JsonArray Parts() =>
    [
        new JsonObject { ["type"] = "text", ["text"] = "What is in this picture?" },
        ContentParts.ImageLabel("court.png"),
        new JsonObject { ["type"] = "image_url", ["image_url"] = new JsonObject { ["url"] = $"data:image/png;base64,{Photo}" } },
    ];

    // ------------------------------------------------------------------ the kernel

    [Fact]
    public async Task A_task_of_parts_reaches_the_model_and_the_log_keeps_only_its_words()
    {
        var agent = TestAgents.Builder(change: a => a with { TaskContent = Parts() });
        var model = new ScriptedModel().ThenText("A squash court.");
        var (result, log) = await TestAgents.RunAsync(agent, model, new FakeWorkspace(), "What is in this picture?");
        Assert.True(result.Completed);
        var sent = Assert.IsType<JsonArray>(model.Calls[0].Messages[1]!["content"]);
        Assert.Equal(Parts().ToJsonString(), sent.ToJsonString());
        var start = log.Events.First(e => e.Type == "message").Payload;
        Assert.Equal("What is in this picture?", start["task"]!.GetValue<string>());
        Assert.Equal(["text", "text", "image_url"], start["parts"]!.AsArray().Select(p => p!["type"]!.GetValue<string>()));
        // No event carries the image itself.
        Assert.All(log.Events, e => Assert.DoesNotContain("base64", e.Payload.ToJsonString(), StringComparison.Ordinal));
    }

    [Fact]
    public async Task A_resumed_session_is_given_its_files_again_from_its_definition()
    {
        var agent = TestAgents.Builder(change: a => a with { TaskContent = Parts() });
        var log = new InMemoryRunLog();
        var model = new ScriptedModel().ThenTool("notes", new { action = "append", text = "a court" }).ThenText("A squash court.");
        log.FailWhen = e => e.Type == "tool.result" ? new IOException("the Runner died") : null;
        await Assert.ThrowsAsync<IOException>(() => new AgentLoop(agent, TestAgents.Services(model), new FakeWorkspace(), log).StartAsync("What is in this picture?", CancellationToken.None));
        log.FailWhen = null;
        var resumed = await new AgentLoop(agent, TestAgents.Services(model), new FakeWorkspace(), log).ResumeAsync(log.Events, "What is in this picture?", CancellationToken.None);
        Assert.True(resumed.Completed);
        Assert.Equal(Parts().ToJsonString(), model.Calls[^1].Messages[1]!["content"]!.ToJsonString());
    }

    [Fact]
    public async Task A_reply_written_as_parts_is_still_an_answer()
    {
        var model = new ScriptedModel().Then(_ => ScriptedModel.Reply(new JsonObject
        {
            ["role"] = "assistant",
            ["content"] = new JsonArray(new JsonObject { ["type"] = "text", ["text"] = "Seven courts" }, new JsonObject { ["type"] = "text", ["text"] = "all booked." }),
        }, 0.01m, "ProviderA", "qwen/qwen3.7-flash"));
        var (result, log) = await TestAgents.RunAsync(TestAgents.Builder(), model, new FakeWorkspace());
        Assert.Equal("Seven courts\n\nall booked.", result.FinalText);
        Assert.Equal("Seven courts\n\nall booked.", Replay.Fold(log.Events, "main").State.FinalText);
    }

    [Fact]
    public void Compaction_counts_an_image_at_its_fixed_figure_and_writes_it_down_by_name()
    {
        var messages = new JsonArray(
            new JsonObject { ["role"] = "system", ["content"] = "You are a test agent." },
            new JsonObject { ["role"] = "user", ["content"] = Parts() });
        Assert.InRange(Compactor.EstimateTokens(messages), ReservationFormula.ImageTokens, ReservationFormula.ImageTokens + 200);
        var transcript = Compactor.Transcript([new JsonObject { ["role"] = "system", ["content"] = "s" }, new JsonObject { ["role"] = "user", ["content"] = Parts() }], 1, 2);
        Assert.Contains("[image: court.png]", transcript, StringComparison.Ordinal);
        Assert.Contains("What is in this picture?", transcript, StringComparison.Ordinal);
        Assert.DoesNotContain("base64", transcript, StringComparison.Ordinal);
        Assert.DoesNotContain("Attached image:", transcript, StringComparison.Ordinal);
    }

    [Fact]
    public void A_message_of_parts_is_marked_for_caching_on_its_last_text_part()
    {
        var marked = ModelTraits.WithCacheMarks(new JsonArray(new JsonObject { ["role"] = "system", ["content"] = "s" }, new JsonObject { ["role"] = "user", ["content"] = Parts() }), "anthropic/claude-sonnet-5.5");
        var parts = marked[1]!["content"]!.AsArray();
        Assert.NotNull(parts[1]!["cache_control"]);
        Assert.Null(parts[2]!["cache_control"]);
        Assert.Null(parts[0]!["cache_control"]);
    }

    // ------------------------------------------------------------------ the conversation workflow

    private static FakeControlPlane Turn(string text, JsonObject? narrow = null, params JsonObject[] files)
    {
        var cp = new FakeControlPlane("frostaura/technologies", "conversation") { Headroom = 100m };
        var said = new JsonObject { ["from"] = "owner", ["text"] = text };
        if (files.Length > 0)
        {
            said["attachments"] = new JsonArray(files.Select(f => (JsonNode)new JsonObject { ["id"] = f["id"]?.DeepClone(), ["name"] = f["name"]?.DeepClone(), ["kind"] = f["kind"]?.DeepClone() }).ToArray());
            foreach (var file in files)
            {
                cp.Attachments.Add(file);
            }
        }

        if (narrow is not null)
        {
            said["narrow"] = narrow;
        }

        cp.Append("message", said);
        return cp;
    }

    private static JsonObject File(string name, string kind, string? text = null, int? pages = null, string? data = null, bool truncated = false) => new()
    {
        ["id"] = Guid.NewGuid().ToString(),
        ["name"] = name,
        ["kind"] = kind,
        ["contentType"] = kind == "image" ? "image/png" : kind == "pdf" ? "application/pdf" : "text/plain; charset=utf-8",
        ["bytes"] = 100,
        ["pages"] = pages,
        ["characters"] = text?.Length,
        ["truncated"] = truncated,
        ["text"] = text,
        ["data"] = data,
    };

    private static Task RunAsync(FakeControlPlane cp, ScriptedModel model) =>
        EstimateTests.Executor(cp, model, workflows: [new ConversationWorkflow()]).ExecuteAsync(cp.Info(), "runner-test", () => false, CancellationToken.None);

    private static IReadOnlyList<string> ToolNames(ChatCall call) => (call.Tools ?? []).Select(t => t!["function"]?["name"]?.GetValue<string>() ?? "").ToList();

    [Fact]
    public async Task The_turns_files_reach_the_model_as_parts_text_fenced_by_name_and_images_as_images()
    {
        var cp = Turn("Which courts are free tonight?", null,
            File("notes.md", "text", "Court 3 is shut.\n```\nnot a fence end\n```"),
            File("minutes.pdf", "pdf", "Courts open at seven.", pages: 2, truncated: true),
            File("court.png", "image", data: Photo),
            File("scan.pdf", "pdf", "", pages: 1));
        var model = new ScriptedModel().ThenText("Courts 1 and 2.");
        await RunAsync(cp, model);

        Assert.Equal("succeeded", cp.Run["status"]!.GetValue<string>());
        Assert.Equal(["chat"], cp.AttachmentTaskTypes);
        var parts = Assert.IsType<JsonArray>(model.Calls[0].Messages[1]!["content"]);
        Assert.Equal(["text", "text", "text", "text", "image_url", "text"], parts.Select(p => p!["type"]!.GetValue<string>()));
        Assert.Contains("Which courts are free tonight?", parts[0]!["text"]!.GetValue<string>(), StringComparison.Ordinal);
        var notes = parts[1]!["text"]!.GetValue<string>();
        Assert.StartsWith("Attached file: notes.md (text file):\n````\n", notes, StringComparison.Ordinal);
        Assert.EndsWith("\n````", notes, StringComparison.Ordinal);
        Assert.Contains("PDF, 2 pages; only its first 21 characters were read", parts[2]!["text"]!.GetValue<string>(), StringComparison.Ordinal);
        Assert.Equal("Attached image: court.png", parts[3]!["text"]!.GetValue<string>());
        Assert.Equal($"data:image/png;base64,{Photo}", parts[4]!["image_url"]!["url"]!.GetValue<string>());
        Assert.Contains("No text could be read from it; it may be scanned pages", parts[5]!["text"]!.GetValue<string>(), StringComparison.Ordinal);
        // Every step of the turn carries them; no event does.
        Assert.All(model.Calls, c => Assert.IsType<JsonArray>(c.Messages[1]!["content"]));
        Assert.All(cp.Events, e => Assert.DoesNotContain(Photo[..64], e.Payload.ToJsonString(), StringComparison.Ordinal));
        Assert.Contains("When the owner's message carries files", model.Calls[0].Messages[0]!["content"]!.GetValue<string>(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task An_image_where_whoever_answers_cannot_look_is_named_not_sent_and_files_alone_are_a_question()
    {
        var cp = Turn("", null, File("court.png", "image", data: Photo));
        cp.ImagesAccepted = false;
        var model = new ScriptedModel().ThenText("I cannot look at images here.");
        await RunAsync(cp, model);
        var parts = model.Calls[0].Messages[1]!["content"]!.AsArray();
        Assert.Equal(ConversationWorkflow.FilesOnly, parts[0]!["text"]!.GetValue<string>());
        Assert.DoesNotContain(parts, p => p!["type"]!.GetValue<string>() == "image_url");
        Assert.Contains("You cannot look at images here", parts[1]!["text"]!.GetValue<string>(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_turn_without_files_is_a_plain_message_and_never_asks_for_files()
    {
        var cp = Turn("How are we doing?");
        var model = new ScriptedModel().ThenText("Well.");
        await RunAsync(cp, model);
        Assert.Equal("How are we doing?", model.Calls[0].Messages[1]!["content"]!.GetValue<string>());
        Assert.DoesNotContain(cp.Requests, r => r.EndsWith("/attachments", StringComparison.Ordinal));
    }

    [Fact]
    public async Task No_web_search_for_this_one_means_no_call_may_search_and_no_one_is_asked()
    {
        var iris = Guid.NewGuid();
        JsonObject Researcher() => new()
        {
            ["employee"] = new JsonObject { ["id"] = iris.ToString(), ["name"] = "Iris", ["role"] = "Researcher", ["jobDescription"] = new JsonObject { ["modelTier"] = "research" } },
        };

        // The rules ask before a conversation searches: asked as usual, then not at all when the message says no searching.
        var asking = Turn("What do rivals charge?");
        asking.Run["employeeId"] = iris.ToString();
        asking.EmployeeDetails[iris] = Researcher();
        asking.RuleSet("conversation", JsonNode.Parse("""{"ask":["web_search"]}""")!);
        var searched = new ScriptedModel().ThenText("About ten pounds an hour.");
        await RunAsync(asking, searched);
        Assert.Contains(asking.Approvals, a => a.Contains("search the web", StringComparison.OrdinalIgnoreCase));
        Assert.All(searched.Calls, c => Assert.NotEqual(0, c.MaxSearches));

        var narrowed = Turn("What do rivals charge?", new JsonObject { ["noWebSearch"] = true });
        narrowed.Run["employeeId"] = iris.ToString();
        narrowed.EmployeeDetails[iris] = Researcher();
        narrowed.RuleSet("conversation", JsonNode.Parse("""{"ask":["web_search"]}""")!);
        var model = new ScriptedModel().ThenText("From what I know, about ten pounds an hour.");
        await RunAsync(narrowed, model);
        Assert.Equal("succeeded", narrowed.Run["status"]!.GetValue<string>());
        Assert.Equal("research", model.Calls[0].TaskType);
        Assert.All(model.Calls, c => Assert.Equal(0, c.MaxSearches));
        Assert.DoesNotContain(narrowed.Approvals, a => a.Contains("search", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task Answer_only_gives_no_tool_that_starts_work_or_changes_a_setting()
    {
        var cp = Turn("Should we build a habit tracker?", new JsonObject { ["answerOnly"] = true });
        var model = new ScriptedModel().ThenText("Probably not yet.");
        await RunAsync(cp, model);
        Assert.Equal(["read_organisation"], ToolNames(model.Calls[0]));
        Assert.Contains(ConversationWorkflow.AnswerOnlyLine, model.Calls[0].Messages[1]!["content"]!.GetValue<string>(), StringComparison.Ordinal);

        var free = Turn("Should we build a habit tracker?");
        var unnarrowed = new ScriptedModel().ThenText("Probably not yet.");
        await RunAsync(free, unnarrowed);
        Assert.Equal(["adjust_setting", "change_app", "read_organisation", "start_idea", "try_again"], ToolNames(unnarrowed.Calls[0]).Order(StringComparer.Ordinal));
    }

    [Fact]
    public async Task Work_a_turn_starts_is_written_into_its_log_with_the_started_runs_id()
    {
        var cp = new FakeControlPlane("frostaura/technologies/recipes/web", "conversation", "Research a habit tracker, add star ratings, and try the failed build again.") { Headroom = 100m };
        var stopped = Guid.NewGuid();
        var model = new ScriptedModel()
            .ThenTool("start_idea", new { text = "A habit tracker.\nFor teams." })
            .ThenTool("change_app", new { request = "Members can rate each recipe." })
            .ThenTool("try_again", new { run_id = stopped.ToString(), title = "Build: Recipe box" })
            .ThenText("All three have started.");
        await RunAsync(cp, model);

        Assert.Equal("succeeded", cp.Run["status"]!.GetValue<string>());
        var started = cp.Events.Where(e => e.Type == "message" && e.Payload["kind"]?.GetValue<string>() == Endgame.Domain.Runs.ConversationMessageKinds.WorkStarted).Select(e => e.Payload).ToList();
        Assert.Equal(cp.Started.Select(r => r["id"]!.GetValue<string>()), started.Select(s => s["runId"]!.GetValue<string>()));
        Assert.Equal(["research", "change", "retry"], started.Select(s => s["workKind"]!.GetValue<string>()));
        Assert.Equal(["A habit tracker.", "Change: Members can rate each recipe.", $"Build again ({stopped:N})"], started.Select(s => s["title"]!.GetValue<string>()));
        // It is the conversation's bookkeeping, not something anyone said.
        Assert.All(started, s => Assert.Null(s["text"]));

        // Declined, nothing starts, so nothing is written.
        var declined = new FakeControlPlane("frostaura/technologies", "conversation", "Start a habit tracker.") { Headroom = 100m, AnswerApproval = _ => false };
        await RunAsync(declined, new ScriptedModel().ThenTool("start_idea", new { text = "A habit tracker." }).ThenText("You declined."));
        Assert.DoesNotContain(declined.Events, e => e.Payload["kind"]?.GetValue<string>() == "work.started");
    }

    [Fact]
    public async Task An_earlier_turns_files_are_named_and_not_read_again()
    {
        var earlier = Guid.NewGuid();
        var cp = Turn("And what about court 4?");
        cp.Run["parentRunId"] = earlier.ToString();
        cp.EarlierRuns[earlier] =
        [
            (1, "message", new JsonObject { ["from"] = "owner", ["text"] = "Which courts are shut?", ["attachments"] = new JsonArray(new JsonObject { ["name"] = "notes.md", ["kind"] = "text" }) }),
            (2, "message", new JsonObject { ["from"] = "assistant", ["text"] = "Court 3." }),
        ];
        var model = new ScriptedModel().ThenText("Court 4 is open.");
        await RunAsync(cp, model);
        var task = model.Calls[0].Messages[1]!["content"]!.GetValue<string>();
        Assert.Contains("Owner: Which courts are shut? [attached: notes.md]", task, StringComparison.Ordinal);
        Assert.Contains("You: Court 3.", task, StringComparison.Ordinal);
    }

    [Fact]
    public void The_conversation_prompt_links_only_what_it_read_by_id()
    {
        var prompt = RunnerResources.Prompt("conversation", new Dictionary<string, string> { ["place"] = "Technologies", ["places"] = "- Technologies" });
        // Apps, employees, work and ideas, each by the id it read: the console draws each as a chip.
        Assert.Contains("[its name](/apps/{id})", prompt, StringComparison.Ordinal);
        Assert.Contains("[its title](/runs/{id})", prompt, StringComparison.Ordinal);
        Assert.Contains("[their name](/employees/{id})", prompt, StringComparison.Ordinal);
        Assert.Contains("[its title](/ideas/{id})", prompt, StringComparison.Ordinal);
        Assert.Contains("Never make up an id", prompt, StringComparison.Ordinal);
    }

    [Fact]
    public void The_conversation_prompt_asks_for_rich_replies_only_where_they_help()
    {
        var prompt = RunnerResources.Prompt("conversation", new Dictionary<string, string> { ["place"] = "Technologies", ["places"] = "- Technologies" });
        // The console renders Markdown fully: the old "no headings, no asterisks, no backticks" rule is gone.
        Assert.DoesNotContain("no headings, no asterisks, no backticks", prompt, StringComparison.Ordinal);
        Assert.Contains("A short answer is one to three plain sentences", prompt, StringComparison.Ordinal);
        Assert.Contains("are a list, one item a line", prompt, StringComparison.Ordinal);
        Assert.Contains("is a table with a header row", prompt, StringComparison.Ordinal);
        Assert.Contains("A heading only when a long answer has several parts", prompt, StringComparison.Ordinal);
        Assert.Contains("Bold only for", prompt, StringComparison.Ordinal);
        // Code only in technical mode or when asked; never a path in inline code, never infrastructure in normal mode.
        Assert.Contains("A fenced code block only when the person has switched on technical mode or asked for code", prompt, StringComparison.Ordinal);
        Assert.Contains("Never put a path, an address or a name in inline code", prompt, StringComparison.Ordinal);
        Assert.Contains("never show a path or infrastructure unless technical mode is on", prompt, StringComparison.Ordinal);
        Assert.Contains("Do not mention containers, stacks, repositories", prompt, StringComparison.Ordinal);
    }

    [Fact]
    public void What_is_read_as_contents_carries_each_app_project_and_division_id_so_a_reply_can_link_it()
    {
        // The read_organisation 'contents' shape the prompt's app links rely on (#6): every place has its id beside its name.
        var json = System.Text.Json.JsonSerializer.SerializeToNode(new Endgame.Infrastructure.Tree.ContentsApp("Club Reading List", "frostaura/community/club/web", "live", null, "healthy", "private", Guid.NewGuid()), Json.Web)!.AsObject();
        Assert.True(Guid.TryParse(json["id"]?.GetValue<string>(), out _));
        Assert.Equal("Club Reading List", json["name"]!.GetValue<string>());
    }

    [Fact]
    public void The_skills_the_console_lists_are_exactly_the_ones_the_agents_load()
    {
        var listed = Endgame.Infrastructure.Work.SkillIndex.All;
        Assert.Equal(AgentFactory.BuilderSkills.Order(StringComparer.Ordinal), listed.Where(s => s.UsedBy == "builders").Select(s => s.Name).Order(StringComparer.Ordinal));
        Assert.Equal(["security-review-checklist"], listed.Where(s => s.UsedBy == "security review").Select(s => s.Name));
        Assert.Equal(RunnerResources.Skills().All.Select(s => (s.Name, s.Trigger)), listed.OrderBy(s => s.Name, StringComparer.Ordinal).Select(s => (s.Name, s.Trigger)));
    }
}
