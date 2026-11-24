using Endgame.Domain.Tree;

namespace Endgame.Infrastructure.Persistence.Records;

/// <summary>
/// A row that sits at a node of the cascade. The node is the deepest non-null of the path ids, and
/// each id is a composite foreign key with the organisation, so a row can never point into another
/// organisation's tree. The full path is carried so roll-ups need no joins.
/// </summary>
public interface IScopedRecord
{
    Guid OrganisationId { get; }

    Guid? DivisionId { get; }

    Guid? ProjectId { get; }

    Guid? AppId { get; }
}

public static class ScopedRecords
{
    public static NodeLevel Level(this IScopedRecord record) =>
        record.AppId is not null ? NodeLevel.App
        : record.ProjectId is not null ? NodeLevel.Project
        : record.DivisionId is not null ? NodeLevel.Division
        : NodeLevel.Organisation;

    public static Guid NodeId(this IScopedRecord record) =>
        record.AppId ?? record.ProjectId ?? record.DivisionId ?? record.OrganisationId;
}
