namespace Endgame.Runner;

/// <summary>The Runner's configuration (section <c>Runner</c>). The service token comes from <c>ENDGAME_SERVICE_TOKEN</c>.</summary>
public sealed class RunnerOptions
{
    public const string SectionName = "Runner";

    public string ControlPlaneUrl { get; set; } = "http://control-plane:8080";

    public string DockUrl { get; set; } = "http://dock:8080";

    /// <summary>Edge's control listener, which apps cannot reach: the evaluator's way into a private preview.</summary>
    public string EdgeControlUrl { get; set; } = "http://edge:8081";

    /// <summary>Runs worked at once by this process.</summary>
    public int Concurrency { get; set; } = 2;

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

    /// <summary>Credits a run of each kind is expected to cost before any history exists (scored, then replaced by history).</summary>
    public Dictionary<string, decimal> EstimatePriors { get; set; } = new(StringComparer.Ordinal)
    {
        ["research"] = 8m,
        ["build"] = 120m,
        ["task"] = 1.5m,
        ["conversation"] = 0.5m,
        ["review"] = 1m,
    };

    /// <summary>Paths no agent may write, whatever any rule says (the protected-path floor), relative to an app's repository.</summary>
    public List<string> ProtectedPaths { get; set; } = ["vendor/**", "api/Migrations/*.Designer.cs", "api/Migrations/*ModelSnapshot.cs", ".github/**", ".endgame/**"];

    public string AuthorDomain { get; set; } = "agents.endgame.frostaura.net";
}
