namespace Endgame.Runner;

/// <summary>The Runner's configuration (section <c>Runner</c>). The service token comes from <c>ENDGAME_SERVICE_TOKEN</c>.</summary>
public sealed class RunnerOptions
{
    public const string SectionName = "Runner";

    public string ControlPlaneUrl { get; set; } = "http://control-plane:8080";

    public string DockUrl { get; set; } = "http://dock:8080";

    /// <summary>Edge's control listener, which apps cannot reach: the evaluator's way into a private preview.</summary>
    public string EdgeControlUrl { get; set; } = "http://edge:8081";

    /// <summary>Runs other than conversations worked at once by this process (its work lane).</summary>
    public int Concurrency { get; set; } = 2;

    /// <summary>Conversations answered at once, in a lane of their own beside the work lane, so a chat never waits behind long runs (D47).</summary>
    public int ConversationConcurrency { get; set; } = 2;

    /// <summary>How long a lease lasts; it is renewed every third of that.</summary>
    public int LeaseSeconds { get; set; } = 90;

    /// <summary>How often an idle Runner asks for work.</summary>
    public double PollSeconds { get; set; } = 2;

    /// <summary>How long a graceful shutdown waits for runs to reach a step boundary.</summary>
    public int ShutdownGraceSeconds { get; set; } = 20;

    /// <summary>The kinds of run this process takes; empty is every kind it has a workflow for.</summary>
    public List<string> Kinds { get; set; } = [];

    /// <summary>
    /// The building tiers, cheapest first: routing-table task types. A failed evaluation moves the
    /// work up one tier (assumptions log, entry 13).
    /// </summary>
    public List<string> BuildTiers { get; set; } = ["build", "build-t1", "build-t2", "build-t3"];

    /// <summary>Task types for the other roles.</summary>
    public string PlanTaskType { get; set; } = "plan";

    public string EvaluateTaskType { get; set; } = "evaluate";

    public string ResearchTaskType { get; set; } = "research";

    public string ReviewTaskType { get; set; } = "evaluate";

    public string ChatTaskType { get; set; } = "chat";

    public string SummaryTaskType { get; set; } = "summarise";

    /// <summary>Repair rounds after a failed evaluation, per feature.</summary>
    public int MaxRepairRounds { get; set; } = 3;

    /// <summary>Contractors a research run fans out.</summary>
    public int ResearchContractors { get; set; } = 3;

    /// <summary>The most web searches one research strand makes (the route allows up to 8 a call).</summary>
    public int ResearchSearchesPerStrand { get; set; } = 7;

    /// <summary>The fewest a strand is given, however small the estimate.</summary>
    public int ResearchMinimumSearches { get; set; } = 2;

    /// <summary>What one search may cost at worst, in credits (its fee plus the results it adds to the prompt): how the estimate is turned into a search budget.</summary>
    public decimal ResearchSearchCredits { get; set; } = 1.7m;

    /// <summary>The share of the research estimate the strands may spend between them; the judge and one corrected verdict take the rest.</summary>
    public decimal ResearchStrandShare { get; set; } = 0.75m;

    /// <summary>What each standing role is expected to cost a month, in credits: its hire is accepted in auto-mode only when this fits the budget.</summary>
    public Dictionary<string, decimal> MonthlyCredits { get; set; } = new(StringComparer.Ordinal)
    {
        ["researcher"] = 400m,
        ["lead"] = 100m,
        ["engineer"] = 1500m,
        ["qa"] = 600m,
        ["operations"] = 100m,
    };

    /// <summary>
    /// Credits a run of each kind is expected to cost before an organisation has history of its own (scored, then
    /// replaced by the median of its finished runs). Measured, not guessed: a build is priced for a typical plan of
    /// four items until it has a plan — the live factory builds of 2026-11-25 cost 13.35 and 14.56 credits for three-item
    /// plans (TEST-201) — and then weighed by it (<see cref="BuildEstimate"/>); research is the control plane's own
    /// calibrated estimate, with this as a fallback.
    /// </summary>
    public Dictionary<string, decimal> EstimatePriors { get; set; } = new(StringComparer.Ordinal)
    {
        ["research"] = 12m,
        ["build"] = 20m,
        ["suggest"] = 2m,
        ["task"] = 1.5m,
        ["change"] = 10m,
        ["conversation"] = 0.5m,
        ["review"] = 1m,
    };

    /// <summary>How a build is estimated from its plan before the organisation has finished builds of its own to learn from.</summary>
    public BuildEstimateWeights BuildEstimate { get; set; } = new();

    /// <summary>Paths no agent may write, whatever any rule says (the protected-path floor), relative to an app's repository.</summary>
    public List<string> ProtectedPaths { get; set; } = ["vendor/**", "api/Migrations/*.Designer.cs", "api/Migrations/*ModelSnapshot.cs", ".github/**", ".endgame/**"];

    public string AuthorDomain { get; set; } = "agents.endgame.frostaura.net";
}

/// <summary>
/// A build's starting estimate, item by item, weighted by what each item involves (section <c>Runner:BuildEstimate</c>).
/// Fitted to the live builds of 2026-11-25 (TEST-201): the three-item reading list (the books kept and served, the list,
/// the add-a-book form and a book's page; five to eight requirements) cost 13.35, 14.56, 17.6 and 23.9 credits, and these
/// weights give 18.5; the five-item club app (three items that keep data, two screens, one item with a signed webhook and
/// a confirmation e-mail; eight requirements) cost 59.1 including one repair, and these weights give 53. A flat four-item
/// figure had estimated it at 20, a third of its cost: the webhook-and-e-mail item alone failed four rounds in its first build.
/// </summary>
public sealed class BuildEstimateWeights
{
    /// <summary>Every item: one builder session, one commit, one evaluation of the running app.</summary>
    public decimal PerItem { get; set; } = 3m;

    /// <summary>An item that keeps data (an entity, a migration, the endpoints that serve it, their tests).</summary>
    public decimal DataItem { get; set; } = 1.5m;

    /// <summary>An item with a screen (a page, a view or a form, with its four states).</summary>
    public decimal Screen { get; set; } = 1m;

    /// <summary>Each platform service an item reaches — webhooks, e-mail, schedules, models — which the evaluator must also show working.</summary>
    public decimal Integration { get; set; } = 12m;

    /// <summary>Each requirement an item covers: every one is shown working in the running app, signed in.</summary>
    public decimal Requirement { get; set; } = 0.75m;
}
