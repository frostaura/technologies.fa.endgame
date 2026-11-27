using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Endgame.Infrastructure.Persistence.Migrations
{
    /// <summary>The files a conversation message carries (ARCH-012), in the database, under the tenant row-level security every organisation's table has.</summary>
    public partial class ConversationAttachments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "conversation_attachments",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    organisation_id = table.Column<Guid>(type: "uuid", nullable: false),
                    division_id = table.Column<Guid>(type: "uuid", nullable: true),
                    project_id = table.Column<Guid>(type: "uuid", nullable: true),
                    app_id = table.Column<Guid>(type: "uuid", nullable: true),
                    employee_id = table.Column<Guid>(type: "uuid", nullable: true),
                    conversation_id = table.Column<Guid>(type: "uuid", nullable: true),
                    run_id = table.Column<Guid>(type: "uuid", nullable: true),
                    uploaded_by = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    content_type = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    kind = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    bytes = table.Column<long>(type: "bigint", nullable: false),
                    pages = table.Column<int>(type: "integer", nullable: true),
                    characters = table.Column<int>(type: "integer", nullable: true),
                    extracted_text = table.Column<string>(type: "text", nullable: true),
                    content = table.Column<byte[]>(type: "bytea", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_conversation_attachments", x => x.id);
                    table.UniqueConstraint("AK_conversation_attachments_organisation_id_id", x => new { x.organisation_id, x.id });
                    table.CheckConstraint("ck_conversation_attachments_bytes", "bytes > 0 AND bytes <= 10485760");
                    table.CheckConstraint("ck_conversation_attachments_kind", "kind IN ('image', 'pdf', 'text')");
                    table.CheckConstraint("ck_conversation_attachments_path", "(app_id IS NULL OR project_id IS NOT NULL) AND (project_id IS NULL OR division_id IS NOT NULL)");
                    table.CheckConstraint("ck_conversation_attachments_sent", "run_id IS NULL OR conversation_id IS NOT NULL");
                    table.ForeignKey(
                        name: "FK_conversation_attachments_apps_organisation_id_project_id_ap~",
                        columns: x => new { x.organisation_id, x.project_id, x.app_id },
                        principalTable: "apps",
                        principalColumns: new[] { "organisation_id", "project_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_conversation_attachments_conversations_organisation_id_conv~",
                        columns: x => new { x.organisation_id, x.conversation_id },
                        principalTable: "conversations",
                        principalColumns: new[] { "organisation_id", "id" },
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_conversation_attachments_divisions_organisation_id_division~",
                        columns: x => new { x.organisation_id, x.division_id },
                        principalTable: "divisions",
                        principalColumns: new[] { "organisation_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_conversation_attachments_employees_organisation_id_employee~",
                        columns: x => new { x.organisation_id, x.employee_id },
                        principalTable: "employees",
                        principalColumns: new[] { "organisation_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_conversation_attachments_organisations_organisation_id",
                        column: x => x.organisation_id,
                        principalTable: "organisations",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_conversation_attachments_projects_organisation_id_division_~",
                        columns: x => new { x.organisation_id, x.division_id, x.project_id },
                        principalTable: "projects",
                        principalColumns: new[] { "organisation_id", "division_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_conversation_attachments_runs_organisation_id_run_id",
                        columns: x => new { x.organisation_id, x.run_id },
                        principalTable: "runs",
                        principalColumns: new[] { "organisation_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_conversation_attachments_users_uploaded_by",
                        column: x => x.uploaded_by,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_conversation_attachments_organisation_id_conversation_id",
                table: "conversation_attachments",
                columns: new[] { "organisation_id", "conversation_id" });

            migrationBuilder.CreateIndex(
                name: "IX_conversation_attachments_organisation_id_division_id_projec~",
                table: "conversation_attachments",
                columns: new[] { "organisation_id", "division_id", "project_id" });

            migrationBuilder.CreateIndex(
                name: "IX_conversation_attachments_organisation_id_employee_id",
                table: "conversation_attachments",
                columns: new[] { "organisation_id", "employee_id" });

            migrationBuilder.CreateIndex(
                name: "IX_conversation_attachments_organisation_id_project_id_app_id",
                table: "conversation_attachments",
                columns: new[] { "organisation_id", "project_id", "app_id" });

            migrationBuilder.CreateIndex(
                name: "IX_conversation_attachments_organisation_id_run_id",
                table: "conversation_attachments",
                columns: new[] { "organisation_id", "run_id" });

            migrationBuilder.CreateIndex(
                name: "IX_conversation_attachments_organisation_id_uploaded_by_conver~",
                table: "conversation_attachments",
                columns: new[] { "organisation_id", "uploaded_by", "conversation_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "IX_conversation_attachments_uploaded_by",
                table: "conversation_attachments",
                column: "uploaded_by");
            migrationBuilder.Sql(TenancySql.EnableFor(["conversation_attachments"]));
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(TenancySql.DisableFor(["conversation_attachments"]));
            migrationBuilder.DropTable(
                name: "conversation_attachments");
        }
    }
}
