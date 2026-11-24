using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Endgame.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AppHandoffsAndConnect : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<Guid>(
                name: "end_user_id",
                table: "app_sessions",
                type: "uuid",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "uuid");

            migrationBuilder.AddColumn<Guid>(
                name: "user_id",
                table: "app_sessions",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "app_handoffs",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    organisation_id = table.Column<Guid>(type: "uuid", nullable: false),
                    app_id = table.Column<Guid>(type: "uuid", nullable: false),
                    end_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    code_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    return_to = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    used_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_app_handoffs", x => x.id);
                    table.CheckConstraint("ck_app_handoffs_subject", "(end_user_id IS NULL) <> (user_id IS NULL)");
                    table.ForeignKey(
                        name: "FK_app_handoffs_app_end_users_organisation_id_end_user_id",
                        columns: x => new { x.organisation_id, x.end_user_id },
                        principalTable: "app_end_users",
                        principalColumns: new[] { "organisation_id", "id" },
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_app_handoffs_apps_organisation_id_app_id",
                        columns: x => new { x.organisation_id, x.app_id },
                        principalTable: "apps",
                        principalColumns: new[] { "organisation_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_app_handoffs_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_app_sessions_user_id",
                table: "app_sessions",
                column: "user_id");

            migrationBuilder.AddCheckConstraint(
                name: "ck_app_sessions_subject",
                table: "app_sessions",
                sql: "(end_user_id IS NULL) <> (user_id IS NULL)");

            migrationBuilder.CreateIndex(
                name: "IX_app_handoffs_code_hash",
                table: "app_handoffs",
                column: "code_hash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_app_handoffs_organisation_id_app_id",
                table: "app_handoffs",
                columns: new[] { "organisation_id", "app_id" });

            migrationBuilder.CreateIndex(
                name: "IX_app_handoffs_organisation_id_end_user_id",
                table: "app_handoffs",
                columns: new[] { "organisation_id", "end_user_id" });

            migrationBuilder.CreateIndex(
                name: "IX_app_handoffs_user_id",
                table: "app_handoffs",
                column: "user_id");

            migrationBuilder.AddForeignKey(
                name: "FK_app_sessions_users_user_id",
                table: "app_sessions",
                column: "user_id",
                principalTable: "users",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            // Row-level security on the new table (see TenancySql), and CONNECT granted to the platform's
            // own roles explicitly: Dock revokes CONNECT from PUBLIC on every database, so these roles
            // must not depend on it being re-granted.
            migrationBuilder.Sql(TenancySql.EnableFor(["app_handoffs"]));
            migrationBuilder.Sql("""
                DO $$
                BEGIN
                    EXECUTE format('GRANT CONNECT ON DATABASE %I TO endgame_app, endgame_system', current_database());
                END $$;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(TenancySql.DisableFor(["app_handoffs"]));
            migrationBuilder.Sql("""
                DO $$
                BEGIN
                    EXECUTE format('REVOKE CONNECT ON DATABASE %I FROM endgame_app, endgame_system', current_database());
                END $$;
                """);

            migrationBuilder.DropForeignKey(
                name: "FK_app_sessions_users_user_id",
                table: "app_sessions");

            migrationBuilder.DropTable(
                name: "app_handoffs");

            migrationBuilder.DropIndex(
                name: "IX_app_sessions_user_id",
                table: "app_sessions");

            migrationBuilder.DropCheckConstraint(
                name: "ck_app_sessions_subject",
                table: "app_sessions");

            migrationBuilder.DropColumn(
                name: "user_id",
                table: "app_sessions");

            migrationBuilder.AlterColumn<Guid>(
                name: "end_user_id",
                table: "app_sessions",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"),
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);
        }
    }
}
