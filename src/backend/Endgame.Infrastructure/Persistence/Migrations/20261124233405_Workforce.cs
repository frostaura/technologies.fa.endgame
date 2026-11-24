using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Endgame.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Workforce : Migration
    {
        private static readonly string[] Tables = ["hire_proposals", "employee_memories", "employee_memory_changes"];

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "runs_finished",
                table: "employees");

            migrationBuilder.DropColumn(
                name: "runs_succeeded",
                table: "employees");

            migrationBuilder.AddColumn<string>(
                name: "brief",
                table: "employees",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "brief_run_id",
                table: "employees",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "briefed_by",
                table: "employees",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "kind",
                table: "employees",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "employee");

            migrationBuilder.AddColumn<string>(
                name: "model_tier",
                table: "employees",
                type: "character varying(60)",
                maxLength: 60,
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "released_at",
                table: "employees",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "reports_to",
                table: "employees",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string[]>(
                name: "services",
                table: "employees",
                type: "text[]",
                nullable: false,
                defaultValueSql: "'{}'::text[]");

            migrationBuilder.AddColumn<string>(
                name: "standing",
                table: "employees",
                type: "character varying(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.AddColumn<string[]>(
                name: "tools",
                table: "employees",
                type: "text[]",
                nullable: false,
                defaultValueSql: "'{}'::text[]");

            migrationBuilder.CreateTable(
                name: "employee_memories",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    organisation_id = table.Column<Guid>(type: "uuid", nullable: false),
                    division_id = table.Column<Guid>(type: "uuid", nullable: true),
                    project_id = table.Column<Guid>(type: "uuid", nullable: true),
                    app_id = table.Column<Guid>(type: "uuid", nullable: true),
                    employee_id = table.Column<Guid>(type: "uuid", nullable: false),
                    title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    body = table.Column<string>(type: "text", nullable: false),
                    kind = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    source_run_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    last_reviewed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    archived_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_employee_memories", x => x.id);
                    table.CheckConstraint("ck_employee_memories_body", "length(body) BETWEEN 1 AND 4000 AND length(title) >= 1");
                    table.CheckConstraint("ck_employee_memories_kind", "kind IN ('fact', 'practice', 'preference', 'lesson')");
                    table.CheckConstraint("ck_employee_memories_path", "(app_id IS NULL OR project_id IS NOT NULL) AND (project_id IS NULL OR division_id IS NOT NULL)");
                    table.ForeignKey(
                        name: "FK_employee_memories_apps_organisation_id_project_id_app_id",
                        columns: x => new { x.organisation_id, x.project_id, x.app_id },
                        principalTable: "apps",
                        principalColumns: new[] { "organisation_id", "project_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_employee_memories_divisions_organisation_id_division_id",
                        columns: x => new { x.organisation_id, x.division_id },
                        principalTable: "divisions",
                        principalColumns: new[] { "organisation_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_employee_memories_employees_organisation_id_employee_id",
                        columns: x => new { x.organisation_id, x.employee_id },
                        principalTable: "employees",
                        principalColumns: new[] { "organisation_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_employee_memories_organisations_organisation_id",
                        column: x => x.organisation_id,
                        principalTable: "organisations",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_employee_memories_projects_organisation_id_division_id_proj~",
                        columns: x => new { x.organisation_id, x.division_id, x.project_id },
                        principalTable: "projects",
                        principalColumns: new[] { "organisation_id", "division_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_employee_memories_runs_organisation_id_source_run_id",
                        columns: x => new { x.organisation_id, x.source_run_id },
                        principalTable: "runs",
                        principalColumns: new[] { "organisation_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "employee_memory_changes",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    organisation_id = table.Column<Guid>(type: "uuid", nullable: false),
                    employee_id = table.Column<Guid>(type: "uuid", nullable: false),
                    memory_id = table.Column<Guid>(type: "uuid", nullable: true),
                    action = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    by = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    run_id = table.Column<Guid>(type: "uuid", nullable: true),
                    detail = table.Column<string>(type: "jsonb", nullable: false),
                    at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_employee_memory_changes", x => x.id);
                    table.CheckConstraint("ck_employee_memory_changes_action", "action IN ('added', 'corrected', 'merged', 'removed', 'archived', 'restored', 'reviewed')");
                    table.CheckConstraint("ck_employee_memory_changes_by", "by IN ('employee', 'person', 'review', 'platform')");
                    table.ForeignKey(
                        name: "FK_employee_memory_changes_employees_organisation_id_employee_~",
                        columns: x => new { x.organisation_id, x.employee_id },
                        principalTable: "employees",
                        principalColumns: new[] { "organisation_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_employee_memory_changes_runs_organisation_id_run_id",
                        columns: x => new { x.organisation_id, x.run_id },
                        principalTable: "runs",
                        principalColumns: new[] { "organisation_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "hire_proposals",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    organisation_id = table.Column<Guid>(type: "uuid", nullable: false),
                    division_id = table.Column<Guid>(type: "uuid", nullable: true),
                    project_id = table.Column<Guid>(type: "uuid", nullable: true),
                    app_id = table.Column<Guid>(type: "uuid", nullable: true),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    trigger = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    need_key = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    reason = table.Column<string>(type: "text", nullable: false),
                    name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    role = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    mandate = table.Column<string>(type: "text", nullable: false),
                    tools = table.Column<string[]>(type: "text[]", nullable: false),
                    services = table.Column<string[]>(type: "text[]", nullable: false),
                    monthly_credit_limit = table.Column<decimal>(type: "numeric(20,6)", precision: 20, scale: 6, nullable: true),
                    model_tier = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: true),
                    reports_to = table.Column<Guid>(type: "uuid", nullable: true),
                    expected_monthly_credits = table.Column<decimal>(type: "numeric(20,6)", precision: 20, scale: 6, nullable: false),
                    contractor_role = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    raised_by_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    raised_by_run_id = table.Column<Guid>(type: "uuid", nullable: true),
                    decided_via = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    decided_by = table.Column<Guid>(type: "uuid", nullable: true),
                    decided_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    decision_note = table.Column<string>(type: "text", nullable: true),
                    employee_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_hire_proposals", x => x.id);
                    table.UniqueConstraint("AK_hire_proposals_organisation_id_id", x => new { x.organisation_id, x.id });
                    table.CheckConstraint("ck_hire_proposals_credits", "expected_monthly_credits >= 0 AND (monthly_credit_limit IS NULL OR monthly_credit_limit >= 0)");
                    table.CheckConstraint("ck_hire_proposals_decided", "(status = 'proposed') = (decided_at IS NULL) AND (decided_via IS NULL OR decided_via IN ('person', 'auto-mode')) AND (status = 'proposed') = (decided_via IS NULL)");
                    table.CheckConstraint("ck_hire_proposals_employee", "(status = 'accepted') = (employee_id IS NOT NULL)");
                    table.CheckConstraint("ck_hire_proposals_path", "(app_id IS NULL OR project_id IS NOT NULL) AND (project_id IS NULL OR division_id IS NOT NULL)");
                    table.CheckConstraint("ck_hire_proposals_status", "status IN ('proposed', 'accepted', 'declined')");
                    table.CheckConstraint("ck_hire_proposals_trigger", "trigger IN ('division', 'stage', 'recurring', 'promotion', 'owner')");
                    table.ForeignKey(
                        name: "FK_hire_proposals_apps_organisation_id_project_id_app_id",
                        columns: x => new { x.organisation_id, x.project_id, x.app_id },
                        principalTable: "apps",
                        principalColumns: new[] { "organisation_id", "project_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_hire_proposals_divisions_organisation_id_division_id",
                        columns: x => new { x.organisation_id, x.division_id },
                        principalTable: "divisions",
                        principalColumns: new[] { "organisation_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_hire_proposals_employees_organisation_id_employee_id",
                        columns: x => new { x.organisation_id, x.employee_id },
                        principalTable: "employees",
                        principalColumns: new[] { "organisation_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_hire_proposals_employees_organisation_id_reports_to",
                        columns: x => new { x.organisation_id, x.reports_to },
                        principalTable: "employees",
                        principalColumns: new[] { "organisation_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_hire_proposals_organisations_organisation_id",
                        column: x => x.organisation_id,
                        principalTable: "organisations",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_hire_proposals_projects_organisation_id_division_id_project~",
                        columns: x => new { x.organisation_id, x.division_id, x.project_id },
                        principalTable: "projects",
                        principalColumns: new[] { "organisation_id", "division_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_hire_proposals_runs_organisation_id_raised_by_run_id",
                        columns: x => new { x.organisation_id, x.raised_by_run_id },
                        principalTable: "runs",
                        principalColumns: new[] { "organisation_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_hire_proposals_users_raised_by_user_id",
                        column: x => x.raised_by_user_id,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "IX_employees_organisation_id_brief_run_id",
                table: "employees",
                columns: new[] { "organisation_id", "brief_run_id" });

            migrationBuilder.CreateIndex(
                name: "IX_employees_organisation_id_briefed_by",
                table: "employees",
                columns: new[] { "organisation_id", "briefed_by" });

            migrationBuilder.CreateIndex(
                name: "IX_employees_organisation_id_reports_to",
                table: "employees",
                columns: new[] { "organisation_id", "reports_to" });

            migrationBuilder.CreateIndex(
                name: "IX_employees_organisation_id_standing",
                table: "employees",
                columns: new[] { "organisation_id", "standing" },
                unique: true,
                filter: "standing IS NOT NULL");

            // Existing rows: a released employee gets its release time; every organisation gets its standing
            // security reviewer (spec, Workforce). Row-level security is forced on employees, so this runs as
            // the platform's bypassing role, then hands the schema changes back. runs_finished and
            // runs_succeeded were counters the track record now derives from the runs themselves (ARCH-002).
            migrationBuilder.Sql("""
                SET LOCAL ROLE endgame_system;
                UPDATE employees SET released_at = COALESCE(last_active_at, created_at) WHERE status = 'released' AND released_at IS NULL;
                INSERT INTO employees (id, organisation_id, kind, name, role, job_description, tools, services, model_tier, status, standing, created_at, last_active_at)
                SELECT gen_random_uuid(), o.id, 'employee', 'Security reviewer', 'Security reviewer',
                       'Checks every app before it is published for misuse of the platform''s services — secrets, sign-in, data, model calls and outbound calls — and blocks publishing on a finding until it is fixed. Reads code; never changes it.',
                       ARRAY['read_file', 'list_files', 'search', 'git_diff', 'load_skill', 'notes'], '{}'::text[], 'evaluate', 'idle', 'security-reviewer', now(), now()
                FROM organisations o
                WHERE NOT EXISTS (SELECT 1 FROM employees e WHERE e.organisation_id = o.id AND e.standing = 'security-reviewer');
                RESET ROLE;
                """);

            migrationBuilder.AddCheckConstraint(
                name: "ck_employees_contractor",
                table: "employees",
                sql: "(kind = 'contractor') = (briefed_by IS NOT NULL)");

            migrationBuilder.AddCheckConstraint(
                name: "ck_employees_kind",
                table: "employees",
                sql: "kind IN ('employee', 'contractor')");

            migrationBuilder.AddCheckConstraint(
                name: "ck_employees_not_self",
                table: "employees",
                sql: "reports_to IS NULL OR reports_to <> id");

            migrationBuilder.AddCheckConstraint(
                name: "ck_employees_released",
                table: "employees",
                sql: "(status = 'released') = (released_at IS NOT NULL)");

            migrationBuilder.AddCheckConstraint(
                name: "ck_employees_standing",
                table: "employees",
                sql: "standing IS NULL OR (kind = 'employee' AND standing IN ('security-reviewer'))");

            migrationBuilder.CreateIndex(
                name: "IX_employee_memories_organisation_id_division_id_project_id",
                table: "employee_memories",
                columns: new[] { "organisation_id", "division_id", "project_id" });

            migrationBuilder.CreateIndex(
                name: "IX_employee_memories_organisation_id_employee_id_archived_at",
                table: "employee_memories",
                columns: new[] { "organisation_id", "employee_id", "archived_at" });

            migrationBuilder.CreateIndex(
                name: "IX_employee_memories_organisation_id_project_id_app_id",
                table: "employee_memories",
                columns: new[] { "organisation_id", "project_id", "app_id" });

            migrationBuilder.CreateIndex(
                name: "IX_employee_memories_organisation_id_source_run_id",
                table: "employee_memories",
                columns: new[] { "organisation_id", "source_run_id" });

            migrationBuilder.CreateIndex(
                name: "IX_employee_memory_changes_organisation_id_employee_id_at",
                table: "employee_memory_changes",
                columns: new[] { "organisation_id", "employee_id", "at" });

            migrationBuilder.CreateIndex(
                name: "IX_employee_memory_changes_organisation_id_run_id",
                table: "employee_memory_changes",
                columns: new[] { "organisation_id", "run_id" });

            migrationBuilder.CreateIndex(
                name: "IX_hire_proposals_organisation_id_division_id_project_id",
                table: "hire_proposals",
                columns: new[] { "organisation_id", "division_id", "project_id" });

            migrationBuilder.CreateIndex(
                name: "IX_hire_proposals_organisation_id_employee_id",
                table: "hire_proposals",
                columns: new[] { "organisation_id", "employee_id" });

            migrationBuilder.CreateIndex(
                name: "IX_hire_proposals_organisation_id_need_key",
                table: "hire_proposals",
                columns: new[] { "organisation_id", "need_key" },
                unique: true,
                filter: "need_key IS NOT NULL AND status <> 'declined'");

            migrationBuilder.CreateIndex(
                name: "IX_hire_proposals_organisation_id_project_id_app_id",
                table: "hire_proposals",
                columns: new[] { "organisation_id", "project_id", "app_id" });

            migrationBuilder.CreateIndex(
                name: "IX_hire_proposals_organisation_id_raised_by_run_id",
                table: "hire_proposals",
                columns: new[] { "organisation_id", "raised_by_run_id" });

            migrationBuilder.CreateIndex(
                name: "IX_hire_proposals_organisation_id_reports_to",
                table: "hire_proposals",
                columns: new[] { "organisation_id", "reports_to" });

            migrationBuilder.CreateIndex(
                name: "IX_hire_proposals_organisation_id_status",
                table: "hire_proposals",
                columns: new[] { "organisation_id", "status" });

            migrationBuilder.CreateIndex(
                name: "IX_hire_proposals_raised_by_user_id",
                table: "hire_proposals",
                column: "raised_by_user_id");

            migrationBuilder.AddForeignKey(
                name: "FK_employees_employees_organisation_id_briefed_by",
                table: "employees",
                columns: new[] { "organisation_id", "briefed_by" },
                principalTable: "employees",
                principalColumns: new[] { "organisation_id", "id" },
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_employees_employees_organisation_id_reports_to",
                table: "employees",
                columns: new[] { "organisation_id", "reports_to" },
                principalTable: "employees",
                principalColumns: new[] { "organisation_id", "id" },
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_employees_runs_organisation_id_brief_run_id",
                table: "employees",
                columns: new[] { "organisation_id", "brief_run_id" },
                principalTable: "runs",
                principalColumns: new[] { "organisation_id", "id" },
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.Sql(TenancySql.EnableFor(Tables));
            migrationBuilder.Sql(TenancySql.AppendOnlyFor(["employee_memory_changes"]));
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(TenancySql.DisableFor(Tables));

            migrationBuilder.DropForeignKey(
                name: "FK_employees_employees_organisation_id_briefed_by",
                table: "employees");

            migrationBuilder.DropForeignKey(
                name: "FK_employees_employees_organisation_id_reports_to",
                table: "employees");

            migrationBuilder.DropForeignKey(
                name: "FK_employees_runs_organisation_id_brief_run_id",
                table: "employees");

            migrationBuilder.DropTable(
                name: "employee_memories");

            migrationBuilder.DropTable(
                name: "employee_memory_changes");

            migrationBuilder.DropTable(
                name: "hire_proposals");

            migrationBuilder.DropIndex(
                name: "IX_employees_organisation_id_brief_run_id",
                table: "employees");

            migrationBuilder.DropIndex(
                name: "IX_employees_organisation_id_briefed_by",
                table: "employees");

            migrationBuilder.DropIndex(
                name: "IX_employees_organisation_id_reports_to",
                table: "employees");

            migrationBuilder.DropIndex(
                name: "IX_employees_organisation_id_standing",
                table: "employees");

            migrationBuilder.DropCheckConstraint(
                name: "ck_employees_contractor",
                table: "employees");

            migrationBuilder.DropCheckConstraint(
                name: "ck_employees_kind",
                table: "employees");

            migrationBuilder.DropCheckConstraint(
                name: "ck_employees_not_self",
                table: "employees");

            migrationBuilder.DropCheckConstraint(
                name: "ck_employees_released",
                table: "employees");

            migrationBuilder.DropCheckConstraint(
                name: "ck_employees_standing",
                table: "employees");

            migrationBuilder.DropColumn(
                name: "brief",
                table: "employees");

            migrationBuilder.DropColumn(
                name: "brief_run_id",
                table: "employees");

            migrationBuilder.DropColumn(
                name: "briefed_by",
                table: "employees");

            migrationBuilder.DropColumn(
                name: "kind",
                table: "employees");

            migrationBuilder.DropColumn(
                name: "model_tier",
                table: "employees");

            migrationBuilder.DropColumn(
                name: "released_at",
                table: "employees");

            migrationBuilder.DropColumn(
                name: "reports_to",
                table: "employees");

            migrationBuilder.DropColumn(
                name: "services",
                table: "employees");

            migrationBuilder.DropColumn(
                name: "standing",
                table: "employees");

            migrationBuilder.DropColumn(
                name: "tools",
                table: "employees");

            migrationBuilder.AddColumn<int>(
                name: "runs_finished",
                table: "employees",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "runs_succeeded",
                table: "employees",
                type: "integer",
                nullable: false,
                defaultValue: 0);
        }
    }
}
