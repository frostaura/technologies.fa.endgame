using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Endgame.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ApprovalsExpire : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_approvals_status",
                table: "approvals");

            migrationBuilder.AddCheckConstraint(
                name: "ck_approvals_status",
                table: "approvals",
                sql: "status IN ('pending', 'approved', 'rejected', 'expired')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_approvals_status",
                table: "approvals");

            migrationBuilder.AddCheckConstraint(
                name: "ck_approvals_status",
                table: "approvals",
                sql: "status IN ('pending', 'approved', 'rejected')");
        }
    }
}
