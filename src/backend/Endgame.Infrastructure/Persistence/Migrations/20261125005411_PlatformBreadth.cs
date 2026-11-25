using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Endgame.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class PlatformBreadth : Migration
    {
        private static readonly string[] TenantTables = ["access_tokens", "notifications", "notification_reads", "idea_suggestions", "app_dashboard_questions", "top_up_requests"];

        /// <summary>
        /// "Ask about this app": a read-only role that can read nothing but four views over one app's
        /// telemetry. The tenant policy (to every role) pins the organisation; a restrictive policy for
        /// this role alone pins the app, from a transaction-local setting the control plane sets.
        /// </summary>
        private const string AskUp = """
            CREATE SCHEMA IF NOT EXISTS ask;
            CREATE OR REPLACE FUNCTION endgame_ask_app() RETURNS uuid
                LANGUAGE sql STABLE
                AS $$ SELECT NULLIF(current_setting('endgame.ask_app_id', true), '')::uuid $$;
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'endgame_ask') THEN
                    CREATE ROLE endgame_ask NOLOGIN NOINHERIT NOBYPASSRLS;
                END IF;
            END $$;
            GRANT endgame_ask TO CURRENT_USER;
            -- The pins are session settings: only the platform's own roles may change one. A query run
            -- as endgame_ask can then never re-point itself at another app or organisation.
            REVOKE EXECUTE ON FUNCTION pg_catalog.set_config(text, text, boolean) FROM PUBLIC;
            GRANT EXECUTE ON FUNCTION pg_catalog.set_config(text, text, boolean) TO endgame_app, endgame_system;
            REVOKE ALL ON SCHEMA ask FROM PUBLIC;
            GRANT USAGE ON SCHEMA ask TO endgame_ask;
            GRANT SELECT ON telemetry_spans, telemetry_events, telemetry_logs, telemetry_metrics TO endgame_ask;
            CREATE POLICY telemetry_spans_ask_app ON telemetry_spans AS RESTRICTIVE FOR SELECT TO endgame_ask USING (app_id = endgame_ask_app());
            CREATE POLICY telemetry_events_ask_app ON telemetry_events AS RESTRICTIVE FOR SELECT TO endgame_ask USING (app_id = endgame_ask_app());
            CREATE POLICY telemetry_logs_ask_app ON telemetry_logs AS RESTRICTIVE FOR SELECT TO endgame_ask USING (app_id = endgame_ask_app());
            CREATE POLICY telemetry_metrics_ask_app ON telemetry_metrics AS RESTRICTIVE FOR SELECT TO endgame_ask USING (app_id = endgame_ask_app());

            CREATE VIEW ask.requests WITH (security_invoker = true) AS
                SELECT start_at AS at, http_method AS method, COALESCE(http_route, url_path) AS route, url_path AS path,
                       http_status AS status, duration_ms,
                       (COALESCE(http_status, 0) >= 500 OR (http_status IS NULL AND status_code = 2)) AS failed
                FROM public.telemetry_spans
                WHERE kind = 2 AND COALESCE(url_path, http_route, '/') !~* '(^|/)health(/|$)';
            CREATE VIEW ask.errors WITH (security_invoker = true) AS
                SELECT start_at AS at, 'request'::text AS source, http_status AS status, COALESCE(http_route, url_path) AS route, name AS message
                FROM public.telemetry_spans
                WHERE kind = 2 AND (COALESCE(http_status, 0) >= 500 OR (http_status IS NULL AND status_code = 2))
                UNION ALL
                SELECT at, 'log'::text, NULL::integer, category, body
                FROM public.telemetry_logs
                WHERE severity_number >= 17;
            CREATE VIEW ask.events WITH (security_invoker = true) AS
                SELECT at, name, user_id, properties FROM public.telemetry_events;
            CREATE VIEW ask.metrics WITH (security_invoker = true) AS
                SELECT at, name, unit, type, value, count, sum FROM public.telemetry_metrics;
            REVOKE ALL ON ALL TABLES IN SCHEMA ask FROM PUBLIC, endgame_app, endgame_system;
            GRANT SELECT ON ask.requests, ask.errors, ask.events, ask.metrics TO endgame_ask;

            REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON platform_settings FROM endgame_app;
            GRANT SELECT ON platform_settings TO endgame_app;
            GRANT SELECT, INSERT, UPDATE ON platform_settings TO endgame_system;
            REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON platform_setting_changes FROM endgame_app;
            GRANT SELECT ON platform_setting_changes TO endgame_app;
            GRANT SELECT, INSERT ON platform_setting_changes TO endgame_system;
            """;

        private const string AskDown = """
            DROP VIEW IF EXISTS ask.requests, ask.errors, ask.events, ask.metrics;
            DROP POLICY IF EXISTS telemetry_spans_ask_app ON telemetry_spans;
            DROP POLICY IF EXISTS telemetry_events_ask_app ON telemetry_events;
            DROP POLICY IF EXISTS telemetry_logs_ask_app ON telemetry_logs;
            DROP POLICY IF EXISTS telemetry_metrics_ask_app ON telemetry_metrics;
            REVOKE SELECT ON telemetry_spans, telemetry_events, telemetry_logs, telemetry_metrics FROM endgame_ask;
            DROP SCHEMA IF EXISTS ask;
            DROP FUNCTION IF EXISTS endgame_ask_app();
            GRANT EXECUTE ON FUNCTION pg_catalog.set_config(text, text, boolean) TO PUBLIC;
            """;
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_runs_kind",
                table: "runs");

            migrationBuilder.AlterColumn<Guid>(
                name: "app_id",
                table: "email_messages",
                type: "uuid",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "uuid");

            migrationBuilder.CreateTable(
                name: "access_tokens",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    organisation_id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    role = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    prefix = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    token_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    last_used_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    revoked_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_access_tokens", x => x.id);
                    table.CheckConstraint("ck_access_tokens_role", "role IN ('admin', 'builder', 'viewer')");
                    table.ForeignKey(
                        name: "FK_access_tokens_organisations_organisation_id",
                        column: x => x.organisation_id,
                        principalTable: "organisations",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_access_tokens_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "app_dashboard_questions",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    organisation_id = table.Column<Guid>(type: "uuid", nullable: false),
                    app_id = table.Column<Guid>(type: "uuid", nullable: false),
                    question = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    sql = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: false),
                    chart = table.Column<string>(type: "jsonb", nullable: false),
                    answer = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    created_by = table.Column<Guid>(type: "uuid", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_app_dashboard_questions", x => x.id);
                    table.ForeignKey(
                        name: "FK_app_dashboard_questions_apps_organisation_id_app_id",
                        columns: x => new { x.organisation_id, x.app_id },
                        principalTable: "apps",
                        principalColumns: new[] { "organisation_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "idea_suggestions",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    organisation_id = table.Column<Guid>(type: "uuid", nullable: false),
                    division_id = table.Column<Guid>(type: "uuid", nullable: true),
                    project_id = table.Column<Guid>(type: "uuid", nullable: true),
                    app_id = table.Column<Guid>(type: "uuid", nullable: true),
                    run_id = table.Column<Guid>(type: "uuid", nullable: false),
                    title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    idea = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: false),
                    gap = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    why_us = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    reuses = table.Column<string[]>(type: "text[]", nullable: false, defaultValueSql: "'{}'::text[]"),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    idea_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    decided_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    decided_by = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_idea_suggestions", x => x.id);
                    table.CheckConstraint("ck_idea_suggestions_path", "(app_id IS NULL OR project_id IS NOT NULL) AND (project_id IS NULL OR division_id IS NOT NULL)");
                    table.CheckConstraint("ck_idea_suggestions_status", "status IN ('open', 'taken', 'dismissed')");
                    table.CheckConstraint("ck_idea_suggestions_taken", "(status = 'taken') = (idea_id IS NOT NULL)");
                    table.ForeignKey(
                        name: "FK_idea_suggestions_apps_organisation_id_project_id_app_id",
                        columns: x => new { x.organisation_id, x.project_id, x.app_id },
                        principalTable: "apps",
                        principalColumns: new[] { "organisation_id", "project_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_idea_suggestions_divisions_organisation_id_division_id",
                        columns: x => new { x.organisation_id, x.division_id },
                        principalTable: "divisions",
                        principalColumns: new[] { "organisation_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_idea_suggestions_ideas_organisation_id_idea_id",
                        columns: x => new { x.organisation_id, x.idea_id },
                        principalTable: "ideas",
                        principalColumns: new[] { "organisation_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_idea_suggestions_organisations_organisation_id",
                        column: x => x.organisation_id,
                        principalTable: "organisations",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_idea_suggestions_projects_organisation_id_division_id_proje~",
                        columns: x => new { x.organisation_id, x.division_id, x.project_id },
                        principalTable: "projects",
                        principalColumns: new[] { "organisation_id", "division_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_idea_suggestions_runs_organisation_id_run_id",
                        columns: x => new { x.organisation_id, x.run_id },
                        principalTable: "runs",
                        principalColumns: new[] { "organisation_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "notifications",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    organisation_id = table.Column<Guid>(type: "uuid", nullable: false),
                    division_id = table.Column<Guid>(type: "uuid", nullable: true),
                    project_id = table.Column<Guid>(type: "uuid", nullable: true),
                    app_id = table.Column<Guid>(type: "uuid", nullable: true),
                    kind = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    severity = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    title = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    detail = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    subject = table.Column<string>(type: "jsonb", nullable: false),
                    dedupe_key = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    emailed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_notifications", x => x.id);
                    table.UniqueConstraint("AK_notifications_organisation_id_id", x => new { x.organisation_id, x.id });
                    table.CheckConstraint("ck_notifications_kind", "kind IN ('verdict', 'approval', 'hire', 'budget.80', 'budget.cap', 'credits.zero', 'overdraft.half', 'overdraft.limit', 'app.crashed', 'security.finding', 'topup.requested')");
                    table.CheckConstraint("ck_notifications_path", "(app_id IS NULL OR project_id IS NOT NULL) AND (project_id IS NULL OR division_id IS NOT NULL)");
                    table.CheckConstraint("ck_notifications_severity", "severity IN ('info', 'urgent')");
                    table.ForeignKey(
                        name: "FK_notifications_apps_organisation_id_project_id_app_id",
                        columns: x => new { x.organisation_id, x.project_id, x.app_id },
                        principalTable: "apps",
                        principalColumns: new[] { "organisation_id", "project_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_notifications_divisions_organisation_id_division_id",
                        columns: x => new { x.organisation_id, x.division_id },
                        principalTable: "divisions",
                        principalColumns: new[] { "organisation_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_notifications_organisations_organisation_id",
                        column: x => x.organisation_id,
                        principalTable: "organisations",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_notifications_projects_organisation_id_division_id_project_~",
                        columns: x => new { x.organisation_id, x.division_id, x.project_id },
                        principalTable: "projects",
                        principalColumns: new[] { "organisation_id", "division_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "platform_setting_changes",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    key = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    before = table.Column<string>(type: "jsonb", nullable: false),
                    after = table.Column<string>(type: "jsonb", nullable: false),
                    changed_by = table.Column<Guid>(type: "uuid", nullable: false),
                    changed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_platform_setting_changes", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "platform_settings",
                columns: table => new
                {
                    key = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    value = table.Column<string>(type: "jsonb", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_by = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_platform_settings", x => x.key);
                });

            migrationBuilder.CreateTable(
                name: "top_up_requests",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    organisation_id = table.Column<Guid>(type: "uuid", nullable: false),
                    credits = table.Column<decimal>(type: "numeric(20,6)", precision: 20, scale: 6, nullable: false),
                    note = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    requested_by = table.Column<Guid>(type: "uuid", nullable: false),
                    requested_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    closed_by = table.Column<Guid>(type: "uuid", nullable: true),
                    closed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    close_note = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    top_up_entry_id = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_top_up_requests", x => x.id);
                    table.CheckConstraint("ck_top_up_requests_closed", "(status = 'open') = (closed_at IS NULL)");
                    table.CheckConstraint("ck_top_up_requests_credits", "credits > 0");
                    table.CheckConstraint("ck_top_up_requests_status", "status IN ('open', 'fulfilled', 'declined')");
                    table.ForeignKey(
                        name: "FK_top_up_requests_organisations_organisation_id",
                        column: x => x.organisation_id,
                        principalTable: "organisations",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "notification_reads",
                columns: table => new
                {
                    organisation_id = table.Column<Guid>(type: "uuid", nullable: false),
                    notification_id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    read_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_notification_reads", x => new { x.organisation_id, x.notification_id, x.user_id });
                    table.ForeignKey(
                        name: "FK_notification_reads_notifications_organisation_id_notificati~",
                        columns: x => new { x.organisation_id, x.notification_id },
                        principalTable: "notifications",
                        principalColumns: new[] { "organisation_id", "id" },
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_notification_reads_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.AddCheckConstraint(
                name: "ck_runs_kind",
                table: "runs",
                sql: "kind IN ('research', 'conversation', 'build', 'task', 'review', 'suggest')");

            migrationBuilder.CreateIndex(
                name: "IX_access_tokens_organisation_id_user_id",
                table: "access_tokens",
                columns: new[] { "organisation_id", "user_id" });

            migrationBuilder.CreateIndex(
                name: "IX_access_tokens_token_hash",
                table: "access_tokens",
                column: "token_hash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_access_tokens_user_id",
                table: "access_tokens",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "IX_app_dashboard_questions_organisation_id_app_id",
                table: "app_dashboard_questions",
                columns: new[] { "organisation_id", "app_id" });

            migrationBuilder.CreateIndex(
                name: "IX_idea_suggestions_organisation_id_created_at",
                table: "idea_suggestions",
                columns: new[] { "organisation_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "IX_idea_suggestions_organisation_id_division_id_project_id",
                table: "idea_suggestions",
                columns: new[] { "organisation_id", "division_id", "project_id" });

            migrationBuilder.CreateIndex(
                name: "IX_idea_suggestions_organisation_id_idea_id",
                table: "idea_suggestions",
                columns: new[] { "organisation_id", "idea_id" });

            migrationBuilder.CreateIndex(
                name: "IX_idea_suggestions_organisation_id_project_id_app_id",
                table: "idea_suggestions",
                columns: new[] { "organisation_id", "project_id", "app_id" });

            migrationBuilder.CreateIndex(
                name: "IX_idea_suggestions_organisation_id_run_id",
                table: "idea_suggestions",
                columns: new[] { "organisation_id", "run_id" });

            migrationBuilder.CreateIndex(
                name: "IX_notification_reads_user_id",
                table: "notification_reads",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "IX_notifications_organisation_id_created_at",
                table: "notifications",
                columns: new[] { "organisation_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "IX_notifications_organisation_id_dedupe_key",
                table: "notifications",
                columns: new[] { "organisation_id", "dedupe_key" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_notifications_organisation_id_division_id_project_id",
                table: "notifications",
                columns: new[] { "organisation_id", "division_id", "project_id" });

            migrationBuilder.CreateIndex(
                name: "IX_notifications_organisation_id_project_id_app_id",
                table: "notifications",
                columns: new[] { "organisation_id", "project_id", "app_id" });

            migrationBuilder.CreateIndex(
                name: "IX_platform_setting_changes_key_changed_at",
                table: "platform_setting_changes",
                columns: new[] { "key", "changed_at" });

            migrationBuilder.CreateIndex(
                name: "IX_top_up_requests_organisation_id_status",
                table: "top_up_requests",
                columns: new[] { "organisation_id", "status" });
            migrationBuilder.Sql(TenancySql.EnableFor(TenantTables));
            migrationBuilder.Sql(TenancySql.AppendOnlyFor(["platform_setting_changes"]));
            migrationBuilder.Sql(AskUp);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(AskDown);
            migrationBuilder.Sql(TenancySql.DisableFor(TenantTables));
            migrationBuilder.Sql("DROP TRIGGER IF EXISTS platform_setting_changes_append_only ON platform_setting_changes;");

            migrationBuilder.DropTable(
                name: "access_tokens");

            migrationBuilder.DropTable(
                name: "app_dashboard_questions");

            migrationBuilder.DropTable(
                name: "idea_suggestions");

            migrationBuilder.DropTable(
                name: "notification_reads");

            migrationBuilder.DropTable(
                name: "platform_setting_changes");

            migrationBuilder.DropTable(
                name: "platform_settings");

            migrationBuilder.DropTable(
                name: "top_up_requests");

            migrationBuilder.DropTable(
                name: "notifications");

            migrationBuilder.DropCheckConstraint(
                name: "ck_runs_kind",
                table: "runs");

            migrationBuilder.AlterColumn<Guid>(
                name: "app_id",
                table: "email_messages",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"),
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);

            migrationBuilder.AddCheckConstraint(
                name: "ck_runs_kind",
                table: "runs",
                sql: "kind IN ('research', 'conversation', 'build', 'task', 'review')");
        }
    }
}
