using Endgame.Harness;
using Endgame.Harness.Permissions;
using Endgame.Infrastructure.Tree;

namespace Endgame.Tests.Harness;

/// <summary>R2-9: the words a person reads about a step under way.</summary>
public sealed class WordingTests
{
    [Theory]
    [InlineData("Looked for what they leave undone", "Let this step search the web: looking for what they leave undone?")]
    [InlineData("Looked for evidence people will pay.", "Let this step search the web: looking for evidence people will pay?")]
    [InlineData("Weighed the evidence and wrote the verdict", "Let this step search the web: weighing the evidence and writing the verdict?")]
    [InlineData("Drew up the plan", "Let this step search the web: drawing up the plan?")]
    [InlineData("Checked the idea against FrostAura's red lines", "Let this step search the web: checking the idea against FrostAura's red lines?")]
    [InlineData(null, "Let this step search the web?")]
    public void A_web_search_approval_names_the_step_by_what_it_is_doing(string? step, string title) =>
        Assert.Equal(title, WebSearch.ApprovalTitle(step));

    [Theory]
    [InlineData("Looked for what they leave undone", "search the web for what they leave undone")]
    [InlineData("Looked for existing products", "search the web for existing products")]
    [InlineData("Weighed the evidence and wrote the verdict", "search the web while weighing the evidence and writing the verdict")]
    [InlineData(null, "search the web for this step")]
    public void A_declined_web_search_is_said_as_what_the_owner_declined(string? step, string declined) =>
        Assert.Equal(declined, WebSearch.Declined(step));

    [Theory]
    [InlineData("Let the agent change part of the app?", "change part of the app")]
    [InlineData("Let this step search the web: looking for existing products?", "search the web: looking for existing products")]
    [InlineData("Start researching an idea: a tide clock?", "start researching an idea: a tide clock")]
    [InlineData("Turn on the “Before the plan is carried out” checkpoint here?", "turn on the “Before the plan is carried out” checkpoint here")]
    public void A_declined_call_is_said_as_the_question_the_owner_answered(string title, string declined) =>
        Assert.Equal(declined, ApprovalDetail.Declined(title));

    [Theory]
    [InlineData(0, 1, 1, 0)]
    [InlineData(1, 4, 2, 1)]
    [InlineData(4, 4, 4, 4)]
    [InlineData(0, 0, 0, 0)]
    public void A_projects_progress_counts_the_step_under_way_from_one(int done, int of, int step, int finished) =>
        Assert.Equal((step, finished), ProgressView.Counting(done, of));

    // ---- C-1, #40: titles and quotes cut at a word, never mid-word ------------------------------------------------------

    [Theory]
    [InlineData("A dive log", 40, "A dive log")]
    [InlineData("A sign-up sheet where members claim a seat in a session", 40, "A sign-up sheet where members claim a…")]
    [InlineData("Line one\nline   two", 40, "Line one line two")]
    [InlineData("Supercalifragilisticexpialidociousandmore", 12, "Supercalifr…")]
    [InlineData("Ends on a comma, then more words follow here", 18, "Ends on a comma…")]
    public void Short_text_is_one_line_cut_at_a_word_with_an_ellipsis(string text, int max, string expected) =>
        Assert.Equal(expected, Endgame.Domain.Words.Clamp(text, max));

    [Fact]
    public void A_quote_is_typographic_and_never_doubled()
    {
        Assert.Equal("“Add a waiting list”", Endgame.Domain.Words.Quoted("\"Add a waiting list\"", 140));
        Assert.Equal("“Add a waiting list”", Endgame.Domain.Words.Quoted("“Add a waiting list”", 140));
        Assert.Equal(142, Endgame.Domain.Words.Quoted(new string('a', 400), 140).Length);
    }

    [Theory]
    [InlineData("Let the agent change part of the app", "Let the agent change part of the app?")]
    [InlineData("Accept this plan?", "Accept this plan?")]
    [InlineData("Change Club Reading List: “add a waiting list”", "Change Club Reading List: “add a waiting list”")]
    public void An_approval_asks_a_question_except_after_the_owners_own_quoted_words(string title, string question) =>
        Assert.Equal(question, Endgame.Harness.AgentLoop.Question(title));

    [Theory]
    [InlineData("build", "Build: A sign-up sheet where members claim a seat in a ...", "Try the build again: “A sign-up sheet where members claim a seat in a”")]
    [InlineData("task", "Change: Add a buddy field.", "Try the change again: “Add a buddy field.”")]
    [InlineData("research", "Research: A tide clock", "Try the research again: “A tide clock”")]
    public void Try_again_names_the_stopped_work_by_its_short_title(string kind, string title, string expected) =>
        Assert.Equal(expected, $"{Endgame.Runner.Agents.ApprovalWording.TryAgainLead(kind, title)}: “{Endgame.Runner.Agents.ApprovalWording.ShortTitle(title)}”");
}
