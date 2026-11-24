using System.Globalization;
using System.Text;
using System.Text.Json;

namespace Endgame.Harness.Bench;

/// <summary>
/// <c>bench</c>: run the task set through the real harness against model tiers and print the tables.
/// <c>baseline</c>: run the hidden checks on the untouched starting state (each must fail).
/// </summary>
internal static class Program
{
    private const decimal HardCapUsd = 8.00m;
    private const decimal StopAtUsd = 7.00m;

    private static async Task<int> Main(string[] args)
    {
        var argv = args.ToList();
        string Option(string name, string fallback)
        {
            var i = argv.IndexOf("--" + name);
            return i >= 0 && i + 1 < argv.Count ? argv[i + 1] : fallback;
        }

        var fixtures = FindFixtures();
        var worktree = Path.GetFullPath(Path.Combine(fixtures, "..", "..", "..", ".."));
        var scratch = Path.Combine(worktree, ".tmp", "bench");
        var allTasks = Directory.GetDirectories(Path.Combine(fixtures, "tasks")).OrderBy(d => int.Parse(Path.GetFileName(d).Split('-')[0][1..], CultureInfo.InvariantCulture)).ToList();
        var chosen = Option("tasks", "all");
        var tasks = (chosen == "all" ? allTasks : allTasks.Where(d => chosen.Split(',').Contains(Path.GetFileName(d)))).Select(BenchTask.Load).ToList();
        var image = Option("image", "endgame-bench-workspace:latest");
        var key = OpenRouterGateway.ReadKey(worktree);
        if (key is null)
        {
            Console.Error.WriteLine("OPENROUTER_API_KEY is not set in the environment or in .env.");
            return 2;
        }

        var ledger = new SpendLedger(Path.Combine(scratch, "ledger.json"), StopAtUsd, HardCapUsd);
        var resultsDirectory = Path.Combine(scratch, DateTime.UtcNow.ToString("yyyyMMdd-HHmmss", CultureInfo.InvariantCulture));
        BenchRunner? runner = null;
        using var routed = new OpenRouterGateway(key, ledger)
        {
            Route = call => runner!.Models.TryGetValue(call.RunId ?? Guid.Empty, out var m) ? m : throw new InvalidOperationException("A call for no known run."),
            Log = call => runner!.Sinks.TryGetValue(call.RunId ?? Guid.Empty, out var s) ? s : null,
        };
        runner = new BenchRunner(routed, image, resultsDirectory);

        switch (argv.FirstOrDefault())
        {
            case "baseline":
                foreach (var task in tasks)
                {
                    var steps = await runner.BaselineAsync(task, CancellationToken.None);
                    var passed = steps.All(s => s.Passed);
                    Console.WriteLine($"{task.Id,-22} {(passed ? "PASSES (bad: the checks prove nothing)" : "fails (good)")}  {string.Join(" ", steps.Select(s => $"{s.Name}={(s.Passed ? "ok" : "FAIL")}"))}");
                    if (argv.Contains("--verbose"))
                    {
                        foreach (var step in steps.Where(s => !s.Passed))
                        {
                            Console.WriteLine($"--- {step.Name}\n{step.Tail}");
                        }
                    }
                }

                return 0;
            case "bench":
                {
                    var models = Option("tiers", "deepseek/deepseek-v4.1-flash").Split(',', StringSplitOptions.RemoveEmptyEntries);
                    var repeats = int.Parse(Option("repeats", "1"), CultureInfo.InvariantCulture);
                    var concurrency = int.Parse(Option("concurrency", "3"), CultureInfo.InvariantCulture);
                    await routed.LoadAsync(models, CancellationToken.None);
                    Console.WriteLine($"Spend so far US${BenchRunner.Money(ledger.Settled)}; this lane stops at US${StopAtUsd} (hard cap US${HardCapUsd}).");
                    foreach (var model in models)
                    {
                        var facts = routed.Facts(model);
                        Console.WriteLine($"  {model}: up to ${facts.PromptPerToken * 1_000_000m:0.###}/M in, ${facts.CompletionPerToken * 1_000_000m:0.###}/M out; sends {string.Join(", ", new[] { "tool_choice", "parallel_tool_calls", "reasoning", "temperature" }.Where(facts.Parameters.Contains))}");
                    }

                    var cells = (from r in Enumerable.Range(1, repeats) from t in tasks from m in models select (Task: t, Model: m, Repeat: r)).ToList();
                    var results = new List<CellResult>();
                    using var gate = new SemaphoreSlim(concurrency);
                    var resultLock = new Lock();
                    await Task.WhenAll(cells.Select(async cell =>
                    {
                        await gate.WaitAsync();
                        try
                        {
                            var result = await runner.RunAsync(cell.Task, cell.Model, cell.Repeat, CancellationToken.None);
                            lock (resultLock)
                            {
                                results.Add(result);
                                File.AppendAllText(Path.Combine(resultsDirectory, "results.jsonl"), JsonSerializer.Serialize(result) + "\n");
                            }

                            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] {cell.Model,-30} {cell.Task.Id,-22} {(result.Passed ? "PASS" : "fail")} steps={result.Steps} edits={result.EditCalls}/{result.FailedEdits} failed cost=${BenchRunner.Money(result.CostUsd)} {result.WallSeconds}s stop={result.StopReason}{(result.Error is null ? "" : " error=" + result.Error)} spent=${BenchRunner.Money(ledger.Settled)}");
                        }
                        finally
                        {
                            gate.Release();
                        }
                    }));

                    var report = Report(results, models, tasks.Select(t => t.Id).ToList(), ledger.Settled);
                    await File.WriteAllTextAsync(Path.Combine(resultsDirectory, "report.md"), report);
                    Console.WriteLine();
                    Console.WriteLine(report);
                    return 0;
                }

            default:
                Console.Error.WriteLine("usage: bench --tiers a,b [--tasks all|t1-x,...] [--repeats 1] [--concurrency 3] | baseline [--tasks ...]");
                return 1;
        }
    }

    private static string Report(List<CellResult> results, IReadOnlyList<string> models, IReadOnlyList<string> tasks, decimal settled)
    {
        var sb = new StringBuilder();
        sb.AppendLine("| Tier | Passed | Steps (mean) | Failed edits | Cost per task | Cost in all | Wall time per task |");
        sb.AppendLine("| --- | --- | --- | --- | --- | --- | --- |");
        foreach (var model in models)
        {
            var rows = results.Where(r => r.Model == model).ToList();
            if (rows.Count == 0)
            {
                continue;
            }

            var edits = rows.Sum(r => r.EditCalls);
            var failed = rows.Sum(r => r.FailedEdits);
            sb.AppendLine(CultureInfo.InvariantCulture, $"| `{model}` | {rows.Count(r => r.Passed)} of {rows.Count} | {rows.Average(r => r.Steps):0.0} | {failed} of {edits} ({(edits == 0 ? 0 : 100.0 * failed / edits):0.0}%) | ${BenchRunner.Money(rows.Average(r => r.CostUsd))} | ${BenchRunner.Money(rows.Sum(r => r.CostUsd))} | {rows.Average(r => r.WallSeconds):0}s |");
        }

        sb.AppendLine();
        sb.AppendLine("| Task | " + string.Join(" | ", models.Select(m => $"`{m}`")) + " |");
        sb.AppendLine("| --- |" + string.Concat(models.Select(_ => " --- |")));
        foreach (var task in tasks)
        {
            var cells = models.Select(m =>
            {
                var rows = results.Where(r => r.Model == m && r.Task == task).ToList();
                if (rows.Count == 0)
                {
                    return "—";
                }

                var r = rows[0];
                var extra = new List<string>();
                if (r.Compactions > 0)
                {
                    extra.Add($"{r.Compactions} compaction{(r.Compactions == 1 ? "" : "s")}");
                }

                if (r.Subagents > 0)
                {
                    extra.Add($"{r.Subagents} sub-agent{(r.Subagents == 1 ? "" : "s")}");
                }

                if (r.EvaluationFailedFirst)
                {
                    extra.Add($"evaluation failed, {r.RepairRounds} repair{(r.RepairRounds == 1 ? "" : "s")}");
                }

                var outcome = r.Passed ? "pass" : $"fail ({(r.FailedChecks.Count > 0 ? string.Join(", ", r.FailedChecks) : r.Error ?? r.StopReason)})";
                return string.Create(CultureInfo.InvariantCulture, $"{outcome}, {r.Steps} steps, ${BenchRunner.Money(r.CostUsd)}{(extra.Count > 0 ? "; " + string.Join("; ", extra) : "")}");
            });
            sb.AppendLine($"| {task} | {string.Join(" | ", cells)} |");
        }

        sb.AppendLine();
        sb.AppendLine(CultureInfo.InvariantCulture, $"Lane spend so far: US${BenchRunner.Money(settled)} of a US$8 cap (stop at US$7).");
        return sb.ToString();
    }

    private static string FindFixtures()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            var candidate = Path.Combine(dir.FullName, "Endgame.Harness.Bench", "Fixtures");
            if (Directory.Exists(candidate))
            {
                return candidate;
            }

            if (Path.GetFileName(dir.FullName) == "Endgame.Harness.Bench" && Directory.Exists(Path.Combine(dir.FullName, "Fixtures")))
            {
                return Path.Combine(dir.FullName, "Fixtures");
            }
        }

        throw new DirectoryNotFoundException("Endgame.Harness.Bench/Fixtures was not found above the binary.");
    }
}
