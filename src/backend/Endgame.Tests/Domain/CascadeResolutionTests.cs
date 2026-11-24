using Endgame.Domain;
using Endgame.Domain.Access;
using Endgame.Domain.Cascade;
using Endgame.Domain.Credits;
using Endgame.Domain.Runs;
using Endgame.Domain.Tree;

namespace Endgame.Tests.Domain;

public sealed class CascadeResolutionTests
{
    private static readonly DateTimeOffset At = new(2026, 11, 24, 12, 0, 0, TimeSpan.Zero);

    private static CascadeEntry Entry(CascadeKind kind, string key, string json, NodeLevel level) =>
        new(kind, key, json, level, Guid.NewGuid(), level.ToWire(), At);

    [Fact]
    public void The_deepest_entry_wins_and_names_its_level_and_what_it_overrides()
    {
        var effective = CascadeResolver.Resolve(CascadeKind.Setting,
        [
            Entry(CascadeKind.Setting, "sleep.mode", "\"auto\"", NodeLevel.Organisation),
            Entry(CascadeKind.Setting, "sleep.mode", "\"always_on\"", NodeLevel.Project),
            Entry(CascadeKind.Setting, "sleep.idle_minutes", "30", NodeLevel.Division),
            Entry(CascadeKind.Budget, "monthly_credits", "5", NodeLevel.App),
        ]);
        Assert.Equal(2, effective.Count);
        var mode = effective.Single(e => e.Key == "sleep.mode");
        Assert.Equal(NodeLevel.Project, mode.SetAt);
        Assert.Equal("\"always_on\"", mode.Entry.ValueJson);
        Assert.Equal(NodeLevel.Organisation, Assert.Single(mode.Overridden).Level);
        Assert.Null(CascadeResolver.ResolveKey(CascadeKind.Context, "missing", []));
    }

    [Fact]
    public void A_role_is_the_deepest_grant_except_that_the_organisation_owner_is_never_narrowed()
    {
        var user = Guid.NewGuid();
        RoleGrant Grant(MemberRole role, NodeLevel level) => new(user, role, level, Guid.NewGuid(), level.ToWire());
        Assert.Equal(MemberRole.Viewer, RoleResolver.Resolve([Grant(MemberRole.Admin, NodeLevel.Organisation), Grant(MemberRole.Viewer, NodeLevel.Division)])!.Role);
        Assert.Equal(MemberRole.Builder, RoleResolver.Resolve([Grant(MemberRole.Viewer, NodeLevel.Organisation), Grant(MemberRole.Builder, NodeLevel.Project)])!.Role);
        Assert.Equal(MemberRole.Owner, RoleResolver.Resolve([Grant(MemberRole.Owner, NodeLevel.Organisation), Grant(MemberRole.Viewer, NodeLevel.App)])!.Role);
        Assert.Null(RoleResolver.Resolve([]));
        Assert.True(MemberRole.Admin.Allows(MemberRole.Builder));
        Assert.False(MemberRole.Viewer.Allows(MemberRole.Builder));
    }

    [Theory]
    [InlineData("frostaura", NodeLevel.Organisation)]
    [InlineData("frostaura/technologies/endgame/console", NodeLevel.App)]
    public void A_scope_path_parses_to_its_level_and_chain(string path, NodeLevel level)
    {
        var scope = ScopePath.Parse(path);
        Assert.Equal(level, scope.Level);
        Assert.Equal((int)level + 1, scope.Chain().Count());
        Assert.Equal(path, scope.ToString());
    }

    [Theory]
    [InlineData("")]
    [InlineData("a/b/c/d/e")]
    [InlineData("frostaura/Bad")]
    public void A_malformed_scope_is_refused(string path) => Assert.Throws<DomainException>(() => ScopePath.Parse(path));

    [Fact]
    public void The_reservation_formula_follows_arch_003()
    {
        Assert.Equal((1000 / 2) + (16 * 3) + 64, ReservationFormula.EstimatePromptTokens(1000, 3));
        var ceiling = new PriceCeiling(0.2m, 0.8m, 0.001m);
        Assert.Equal((612m * 0.2m / 1_000_000m) + (4000m * 0.8m / 1_000_000m) + 0.001m + 0.03m,
            ReservationFormula.WorstCaseUsd(612, 4000, ceiling, searchFeesUsd: 0.03m));
        Assert.Equal(4000, ReservationFormula.ClampMaxTokens(10_000_000, 4000, 65536));
        Assert.Equal(100, ReservationFormula.ClampMaxTokens(100, 4000, 65536));
        Assert.Equal(512, ReservationFormula.ClampMaxTokens(null, 4000, 512));
        Assert.Throws<DomainException>(() => ReservationFormula.WorstCaseUsd(1, 0, ceiling));
    }

    [Fact]
    public void Building_over_a_no_needs_an_overrule()
    {
        Assert.False(IdeaDecisions.IsAllowed(IdeaDecisions.Build, Verdicts.DoNotBuild));
        Assert.True(IdeaDecisions.IsAllowed(IdeaDecisions.Overrule, Verdicts.DoNotBuild));
        Assert.False(IdeaDecisions.IsAllowed(IdeaDecisions.Overrule, Verdicts.Build));
        Assert.True(IdeaDecisions.IsAllowed(IdeaDecisions.Build, Verdicts.Change));
    }
}
