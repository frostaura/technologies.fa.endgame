using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Endgame.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class FactoryDecisionsAndRedLines : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "decided_via",
                table: "ideas",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "red_line",
                table: "ideas",
                type: "character varying(300)",
                maxLength: 300,
                nullable: true);

            // Decisions taken before this migration were people's; a red line already recorded in a verdict
            // document is carried into its column. Row-level security is forced on ideas, so the backfill
            // runs as the platform's bypassing role, then hands the schema changes back.
            migrationBuilder.Sql("""
                SET LOCAL ROLE endgame_system;
                UPDATE ideas SET decided_via = 'person' WHERE decision IS NOT NULL;
                UPDATE ideas SET red_line = LEFT(COALESCE(NULLIF(TRIM(verdict_evidence -> 'redLines' ->> 'line'), ''), 'unnamed'), 300)
                WHERE jsonb_typeof(verdict_evidence -> 'redLines' -> 'breached') = 'boolean'
                  AND (verdict_evidence -> 'redLines' ->> 'breached')::boolean
                  AND (decision IS NULL OR decision IN ('change', 'drop'));
                RESET ROLE;
                """);

            migrationBuilder.AddCheckConstraint(
                name: "ck_ideas_decided_via",
                table: "ideas",
                sql: "(decision IS NULL) = (decided_via IS NULL) AND (decided_via IS NULL OR decided_via IN ('person', 'auto-mode'))");

            migrationBuilder.AddCheckConstraint(
                name: "ck_ideas_red_line",
                table: "ideas",
                sql: "red_line IS NULL OR decision IS NULL OR decision IN ('change', 'drop')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_ideas_decided_via",
                table: "ideas");

            migrationBuilder.DropCheckConstraint(
                name: "ck_ideas_red_line",
                table: "ideas");

            migrationBuilder.DropColumn(
                name: "decided_via",
                table: "ideas");

            migrationBuilder.DropColumn(
                name: "red_line",
                table: "ideas");
        }
    }
}
