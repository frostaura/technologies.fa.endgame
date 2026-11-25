using System.Security.Claims;
using System.Text.Json.Nodes;
using Endgame.Infrastructure.Access;
using Microsoft.AspNetCore.Http.Metadata;

namespace Endgame.ControlPlane.Endpoints;

/// <summary>
/// God mode is never silent (CLAUDE.md rule 1): every change an operator makes inside an organisation
/// they entered as an Admin — a hire decided, a cap or a secret set, a person invited — is written to
/// that organisation's operator log, one entry per action, with a plain title its Owner can read. Reads
/// are covered by the visit entry and are not repeated. Nothing from the request body is recorded, so a
/// secret's value never reaches the log.
/// </summary>
internal sealed class OperatorActionLog : IEndpointFilter
{
    public const string Prefix = "admin.";

    /// <summary>What each change is called in the log. Anything not named here is described by its summary.</summary>
    private static readonly Dictionary<string, string> Titles = new(StringComparer.Ordinal)
    {
        ["UpdateOrganisation"] = "Renamed, suspended or reinstated the organisation",
        ["CreateDivision"] = "Added a division",
        ["UpdateDivision"] = "Changed a division",
        ["DeleteDivision"] = "Deleted a division",
        ["CreateProject"] = "Added a project",
        ["UpdateProject"] = "Changed a project",
        ["DeleteProject"] = "Deleted a project",
        ["CreateApp"] = "Added an app",
        ["UpdateApp"] = "Changed an app",
        ["DeleteApp"] = "Deleted an app",
        ["SetCascadeValue"] = "Changed a setting, budget or rule",
        ["RemoveCascadeValue"] = "Removed a setting, budget or rule",
        ["GrantRole"] = "Gave someone a role",
        ["ChangeRole"] = "Changed someone's role",
        ["RevokeRole"] = "Removed someone's role",
        ["ReissueInvitation"] = "Sent someone a new invitation code",
        ["SetOverdraftLimit"] = "Set a tighter overdraft limit",
        ["SetSecret"] = "Set a secret",
        ["RemoveSecret"] = "Removed a secret",
        ["ShareApp"] = "Shared an app",
        ["UnshareApp"] = "Stopped sharing an app",
        ["UpdateAppSettings"] = "Changed how an app runs or who may open it",
        ["RestoreAppVersion"] = "Restored an earlier version of an app",
        ["AskAboutApp"] = "Asked a question of an app's data",
        ["SaveDashboardQuestion"] = "Saved a question to an app's dashboard",
        ["RemoveDashboardQuestion"] = "Removed a question from an app's dashboard",
        ["CreateIdea"] = "Started research on an idea",
        ["DecideIdea"] = "Decided on a verdict",
        ["SuggestIdeas"] = "Asked for ideas from the portfolio",
        ["TakeSuggestion"] = "Took a suggested idea",
        ["DismissSuggestion"] = "Dismissed a suggested idea",
        ["PauseRun"] = "Paused a piece of work",
        ["ResumeRun"] = "Resumed a piece of work",
        ["CancelRun"] = "Cancelled a piece of work",
        ["AnswerApproval"] = "Answered an approval",
        ["PostMessage"] = "Wrote in a conversation",
        ["AcceptHire"] = "Accepted a hire",
        ["DeclineHire"] = "Declined a hire",
        ["EditHire"] = "Changed a hire proposal",
        ["HireEmployee"] = "Asked for a hire",
        ["UpdateEmployee"] = "Changed an employee",
        ["ReassignEmployee"] = "Moved an employee",
        ["ReleaseEmployee"] = "Let an employee go",
        ["StopContractor"] = "Stopped a contractor",
        ["RehireEmployee"] = "Rehired an employee",
        ["AddMemory"] = "Added to an employee's memory",
        ["CorrectMemory"] = "Corrected an employee's memory",
        ["RemoveMemory"] = "Removed from an employee's memory",
        ["ReviewMemory"] = "Started a review of an employee's memory",
        ["ApplyMemoryReview"] = "Applied a memory review",
        ["SetAutonomy"] = "Changed how much is decided automatically",
        ["RemoveAutonomySetting"] = "Removed an autonomy setting",
        ["SetRuleSet"] = "Changed a stage's rules",
        ["RemoveRuleSet"] = "Removed a stage's rules",
        ["CreateAccessToken"] = "Made a key for an AI assistant",
        ["RevokeAccessToken"] = "Revoked an AI assistant's key",
    };

    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(next);
        var result = await next(context);
        var http = context.HttpContext;
        if (HttpMethods.IsGet(http.Request.Method) || HttpMethods.IsHead(http.Request.Method) || HttpMethods.IsOptions(http.Request.Method))
        {
            return result;
        }

        var status = result is IStatusCodeHttpResult { StatusCode: { } code } ? code : http.Response.StatusCode;
        var access = http.RequestServices.GetRequiredService<AccessService>();
        if (status >= 400 || access.ActedAsOperatorIn.Count == 0 || !Guid.TryParse(http.User.FindFirstValue(ClaimTypes.NameIdentifier), out var operatorId))
        {
            return result;
        }

        var endpoint = http.GetEndpoint();
        var name = endpoint?.Metadata.GetMetadata<IEndpointNameMetadata>()?.EndpointName ?? "Unnamed";
        var title = Titles.TryGetValue(name, out var known)
            ? known
            : endpoint?.Metadata.GetMetadata<IEndpointSummaryMetadata>()?.Summary is { Length: > 0 } summary ? FirstSentence(summary) : "Changed something as an Admin";
        foreach (var (organisationId, scope) in access.ActedAsOperatorIn)
        {
            await access.LogActionAsync(operatorId, organisationId, Prefix + name, new JsonObject
            {
                ["title"] = title,
                ["scope"] = scope,
                ["method"] = http.Request.Method,
                ["path"] = http.Request.Path.Value,
            }, http.RequestAborted);
        }

        return result;
    }

    private static string FirstSentence(string text)
    {
        var end = text.IndexOf(". ", StringComparison.Ordinal);
        var sentence = (end > 0 ? text[..end] : text).TrimEnd('.');
        return sentence.Length > 120 ? sentence[..117] + "..." : sentence;
    }
}
