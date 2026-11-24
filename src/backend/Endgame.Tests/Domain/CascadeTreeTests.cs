using Endgame.Domain;
using Endgame.Domain.Tree;

namespace Endgame.Tests.Domain;

public sealed class CascadeTreeTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 24, 12, 0, 0, TimeSpan.Zero);

    [Theory]
    [InlineData("frostaura")]
    [InlineData("technologies")]
    [InlineData("squash-control-system")]
    [InlineData("a")]
    [InlineData("app2")]
    public void Accepts_dns_label_slugs(string slug) => Assert.True(SlugRules.IsValid(slug));

    [Theory]
    [InlineData("")]
    [InlineData(" ")]
    [InlineData("FrostAura")]
    [InlineData("-leading")]
    [InlineData("trailing-")]
    [InlineData("double--hyphen")]
    [InlineData("under_score")]
    [InlineData("dot.ted")]
    [InlineData("spa ce")]
    [InlineData("ünïcode")]
    public void Rejects_slugs_that_are_not_one_dns_label(string slug)
    {
        Assert.False(SlugRules.IsValid(slug));
        Assert.Throws<DomainException>(() => Organisation.Create("FrostAura", slug, Now));
    }

    [Fact]
    public void A_slug_is_at_most_63_characters()
    {
        Assert.True(SlugRules.IsValid(new string('a', 63)));
        Assert.False(SlugRules.IsValid(new string('a', 64)));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void A_name_cannot_be_empty(string name) =>
        Assert.Throws<DomainException>(() => Organisation.Create(name, "frostaura", Now));

    [Fact]
    public void A_name_is_trimmed_and_bounded()
    {
        Assert.Equal("FrostAura", Organisation.Create("  FrostAura  ", "frostaura", Now).Name);
        Assert.Throws<DomainException>(() => Organisation.Create(new string('x', TreeNode.MaxNameLength + 1), "frostaura", Now));
    }

    [Fact]
    public void Each_child_is_linked_to_exactly_the_parent_it_was_created_under()
    {
        var organisation = Organisation.Create("FrostAura", "frostaura", Now);
        var division = Division.Create(organisation, "Technologies", "technologies", Now);
        var project = Project.Create(division, "Endgame", "endgame", Now);
        var app = App.Create(project, "Console", "console", Now);

        Assert.Equal(organisation.Id, division.OrganisationId);
        Assert.Equal(division.Id, project.DivisionId);
        Assert.Equal(project.Id, app.ProjectId);
        Assert.All(new TreeNode[] { organisation, division, project, app }, n => Assert.NotEqual(Guid.Empty, n.Id));
    }

    [Fact]
    public void A_child_cannot_be_created_without_a_parent()
    {
        Assert.Throws<ArgumentNullException>(() => Division.Create(null!, "Technologies", "technologies", Now));
        Assert.Throws<ArgumentNullException>(() => Project.Create(null!, "Endgame", "endgame", Now));
        Assert.Throws<ArgumentNullException>(() => App.Create(null!, "Console", "console", Now));
    }

    [Fact]
    public void The_parent_link_cannot_be_reassigned()
    {
        // "Exactly one parent" includes "never a second one later": no level exposes a public setter
        // or method that changes its parent id.
        foreach (var (type, property) in new[]
                 {
                     (typeof(Division), nameof(Division.OrganisationId)),
                     (typeof(Project), nameof(Project.DivisionId)),
                     (typeof(App), nameof(App.ProjectId)),
                 })
        {
            var setter = type.GetProperty(property)!.SetMethod;
            Assert.True(setter is null || !setter.IsPublic, $"{type.Name}.{property} must not be publicly settable.");
        }
    }

    [Fact]
    public void Created_at_is_stored_in_utc()
    {
        var local = new DateTimeOffset(2026, 11, 24, 14, 0, 0, TimeSpan.FromHours(2));
        var organisation = Organisation.Create("FrostAura", "frostaura", local);
        Assert.Equal(TimeSpan.Zero, organisation.CreatedAt.Offset);
        Assert.Equal(local.UtcDateTime, organisation.CreatedAt.UtcDateTime);
    }
}
