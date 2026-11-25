using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Endgame.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class PlatformCosts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "platform_costs",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    purpose = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    model = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    generation_id = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    cost_usd = table.Column<decimal>(type: "numeric(18,8)", precision: 18, scale: 8, nullable: false),
                    detail = table.Column<string>(type: "jsonb", nullable: false),
                    by = table.Column<Guid>(type: "uuid", nullable: true),
                    at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_platform_costs", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_platform_costs_purpose_at",
                table: "platform_costs",
                columns: new[] { "purpose", "at" });

            // A platform cost is a record of money spent: never updated or deleted, like the ledger.
            migrationBuilder.Sql("CREATE TRIGGER platform_costs_append_only BEFORE UPDATE OR DELETE ON platform_costs FOR EACH ROW EXECUTE FUNCTION endgame_refuse_change();");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "platform_costs");
        }
    }
}
