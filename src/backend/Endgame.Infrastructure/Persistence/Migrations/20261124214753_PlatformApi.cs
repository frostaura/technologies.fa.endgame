using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Endgame.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class PlatformApi : Migration
    {
        private static readonly string[] PlatformTables =
        [
            "app_tokens", "app_end_users", "app_end_user_passkeys", "app_sessions", "app_shares", "app_schedules", "app_webhooks",
            "email_messages", "telemetry_events", "telemetry_spans", "telemetry_metrics", "telemetry_logs", "hosting_samples",
        ];

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_credit_entries_kind",
                table: "credit_entries");

            migrationBuilder.CreateTable(
                name: "app_end_users",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    organisation_id = table.Column<Guid>(type: "uuid", nullable: false),
                    app_id = table.Column<Guid>(type: "uuid", nullable: false),
                    email = table.Column<string>(type: "character varying(254)", maxLength: 254, nullable: false),
                    display_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    last_sign_in_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_app_end_users", x => x.id);
                    table.UniqueConstraint("AK_app_end_users_organisation_id_id", x => new { x.organisation_id, x.id });
                    table.ForeignKey(
                        name: "FK_app_end_users_apps_organisation_id_app_id",
                        columns: x => new { x.organisation_id, x.app_id },
                        principalTable: "apps",
                        principalColumns: new[] { "organisation_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "app_schedules",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    organisation_id = table.Column<Guid>(type: "uuid", nullable: false),
                    app_id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    cron = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    time_zone = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    path = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    next_run_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    lease_holder = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    lease_expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    last_run_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    last_scheduled_for = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    last_status = table.Column<int>(type: "integer", nullable: true),
                    last_error = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_app_schedules", x => x.id);
                    table.ForeignKey(
                        name: "FK_app_schedules_apps_organisation_id_app_id",
                        columns: x => new { x.organisation_id, x.app_id },
                        principalTable: "apps",
                        principalColumns: new[] { "organisation_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "app_shares",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    organisation_id = table.Column<Guid>(type: "uuid", nullable: false),
                    app_id = table.Column<Guid>(type: "uuid", nullable: false),
                    email = table.Column<string>(type: "character varying(254)", maxLength: 254, nullable: false),
                    invitation_code_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    invitation_expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    invited_by = table.Column<Guid>(type: "uuid", nullable: false),
                    invited_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_app_shares", x => x.id);
                    table.ForeignKey(
                        name: "FK_app_shares_apps_organisation_id_app_id",
                        columns: x => new { x.organisation_id, x.app_id },
                        principalTable: "apps",
                        principalColumns: new[] { "organisation_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "app_tokens",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    organisation_id = table.Column<Guid>(type: "uuid", nullable: false),
                    app_id = table.Column<Guid>(type: "uuid", nullable: false),
                    salt = table.Column<byte[]>(type: "bytea", nullable: false),
                    token_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    valid_until = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_app_tokens", x => x.id);
                    table.ForeignKey(
                        name: "FK_app_tokens_apps_organisation_id_app_id",
                        columns: x => new { x.organisation_id, x.app_id },
                        principalTable: "apps",
                        principalColumns: new[] { "organisation_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "app_webhooks",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    organisation_id = table.Column<Guid>(type: "uuid", nullable: false),
                    app_id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    path = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_app_webhooks", x => x.id);
                    table.ForeignKey(
                        name: "FK_app_webhooks_apps_organisation_id_app_id",
                        columns: x => new { x.organisation_id, x.app_id },
                        principalTable: "apps",
                        principalColumns: new[] { "organisation_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "email_messages",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    organisation_id = table.Column<Guid>(type: "uuid", nullable: false),
                    app_id = table.Column<Guid>(type: "uuid", nullable: false),
                    recipients = table.Column<string[]>(type: "text[]", nullable: false),
                    subject = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    text_body = table.Column<string>(type: "text", nullable: false),
                    html_body = table.Column<string>(type: "text", nullable: true),
                    reply_to = table.Column<string>(type: "character varying(254)", maxLength: 254, nullable: true),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    attempts = table.Column<int>(type: "integer", nullable: false),
                    next_attempt_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    lease_until = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    last_error = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    sent_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_email_messages", x => x.id);
                    table.CheckConstraint("ck_email_messages_status", "status IN ('queued', 'sending', 'sent', 'failed')");
                    table.ForeignKey(
                        name: "FK_email_messages_apps_organisation_id_app_id",
                        columns: x => new { x.organisation_id, x.app_id },
                        principalTable: "apps",
                        principalColumns: new[] { "organisation_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "hosting_samples",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    organisation_id = table.Column<Guid>(type: "uuid", nullable: false),
                    app_id = table.Column<Guid>(type: "uuid", nullable: false),
                    sample_id = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    period_start = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    period_end = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    awake_seconds = table.Column<long>(type: "bigint", nullable: false),
                    memory_bytes = table.Column<long>(type: "bigint", nullable: false),
                    storage_bytes = table.Column<long>(type: "bigint", nullable: false),
                    requests = table.Column<long>(type: "bigint", nullable: false),
                    cost_usd = table.Column<decimal>(type: "numeric(20,10)", precision: 20, scale: 10, nullable: false),
                    credits = table.Column<decimal>(type: "numeric(20,6)", precision: 20, scale: 6, nullable: false),
                    credit_entry_id = table.Column<Guid>(type: "uuid", nullable: false),
                    received_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_hosting_samples", x => x.id);
                    table.CheckConstraint("ck_hosting_samples_period", "period_end > period_start AND awake_seconds >= 0 AND memory_bytes >= 0 AND storage_bytes >= 0 AND requests >= 0");
                    table.ForeignKey(
                        name: "FK_hosting_samples_apps_organisation_id_app_id",
                        columns: x => new { x.organisation_id, x.app_id },
                        principalTable: "apps",
                        principalColumns: new[] { "organisation_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_hosting_samples_credit_entries_organisation_id_credit_entry~",
                        columns: x => new { x.organisation_id, x.credit_entry_id },
                        principalTable: "credit_entries",
                        principalColumns: new[] { "organisation_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "telemetry_events",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    organisation_id = table.Column<Guid>(type: "uuid", nullable: false),
                    app_id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    user_id = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    properties = table.Column<string>(type: "jsonb", nullable: false),
                    received_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_telemetry_events", x => x.id);
                    table.ForeignKey(
                        name: "FK_telemetry_events_apps_organisation_id_app_id",
                        columns: x => new { x.organisation_id, x.app_id },
                        principalTable: "apps",
                        principalColumns: new[] { "organisation_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "telemetry_logs",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    organisation_id = table.Column<Guid>(type: "uuid", nullable: false),
                    app_id = table.Column<Guid>(type: "uuid", nullable: false),
                    at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    severity_number = table.Column<int>(type: "integer", nullable: false),
                    severity_text = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    body = table.Column<string>(type: "text", nullable: false),
                    category = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    trace_id = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    span_id = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    received_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_telemetry_logs", x => x.id);
                    table.ForeignKey(
                        name: "FK_telemetry_logs_apps_organisation_id_app_id",
                        columns: x => new { x.organisation_id, x.app_id },
                        principalTable: "apps",
                        principalColumns: new[] { "organisation_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "telemetry_metrics",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    organisation_id = table.Column<Guid>(type: "uuid", nullable: false),
                    app_id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    unit = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    type = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    value = table.Column<double>(type: "double precision", nullable: true),
                    count = table.Column<long>(type: "bigint", nullable: true),
                    sum = table.Column<double>(type: "double precision", nullable: true),
                    received_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_telemetry_metrics", x => x.id);
                    table.ForeignKey(
                        name: "FK_telemetry_metrics_apps_organisation_id_app_id",
                        columns: x => new { x.organisation_id, x.app_id },
                        principalTable: "apps",
                        principalColumns: new[] { "organisation_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "telemetry_spans",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    organisation_id = table.Column<Guid>(type: "uuid", nullable: false),
                    app_id = table.Column<Guid>(type: "uuid", nullable: false),
                    trace_id = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    span_id = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    parent_span_id = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    name = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    kind = table.Column<int>(type: "integer", nullable: false),
                    start_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    duration_ms = table.Column<double>(type: "double precision", nullable: false),
                    status_code = table.Column<int>(type: "integer", nullable: false),
                    http_method = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    http_route = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    url_path = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    http_status = table.Column<int>(type: "integer", nullable: true),
                    received_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_telemetry_spans", x => x.id);
                    table.ForeignKey(
                        name: "FK_telemetry_spans_apps_organisation_id_app_id",
                        columns: x => new { x.organisation_id, x.app_id },
                        principalTable: "apps",
                        principalColumns: new[] { "organisation_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "app_end_user_passkeys",
                columns: table => new
                {
                    organisation_id = table.Column<Guid>(type: "uuid", nullable: false),
                    credential_id = table.Column<byte[]>(type: "bytea", maxLength: 1024, nullable: false),
                    app_id = table.Column<Guid>(type: "uuid", nullable: false),
                    end_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    public_key = table.Column<byte[]>(type: "bytea", nullable: false),
                    name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    sign_count = table.Column<long>(type: "bigint", nullable: false),
                    transports = table.Column<string[]>(type: "text[]", nullable: true),
                    is_user_verified = table.Column<bool>(type: "boolean", nullable: false),
                    is_backup_eligible = table.Column<bool>(type: "boolean", nullable: false),
                    is_backed_up = table.Column<bool>(type: "boolean", nullable: false),
                    attestation_object = table.Column<byte[]>(type: "bytea", nullable: false),
                    client_data_json = table.Column<byte[]>(type: "bytea", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_app_end_user_passkeys", x => new { x.organisation_id, x.credential_id });
                    table.ForeignKey(
                        name: "FK_app_end_user_passkeys_app_end_users_organisation_id_end_use~",
                        columns: x => new { x.organisation_id, x.end_user_id },
                        principalTable: "app_end_users",
                        principalColumns: new[] { "organisation_id", "id" },
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_app_end_user_passkeys_apps_organisation_id_app_id",
                        columns: x => new { x.organisation_id, x.app_id },
                        principalTable: "apps",
                        principalColumns: new[] { "organisation_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "app_sessions",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    organisation_id = table.Column<Guid>(type: "uuid", nullable: false),
                    app_id = table.Column<Guid>(type: "uuid", nullable: false),
                    end_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    token_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    revoked_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_app_sessions", x => x.id);
                    table.ForeignKey(
                        name: "FK_app_sessions_app_end_users_organisation_id_end_user_id",
                        columns: x => new { x.organisation_id, x.end_user_id },
                        principalTable: "app_end_users",
                        principalColumns: new[] { "organisation_id", "id" },
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_app_sessions_apps_organisation_id_app_id",
                        columns: x => new { x.organisation_id, x.app_id },
                        principalTable: "apps",
                        principalColumns: new[] { "organisation_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.AddCheckConstraint(
                name: "ck_credit_entries_kind",
                table: "credit_entries",
                sql: "kind IN ('top_up', 'reservation', 'settlement', 'release', 'hosting')");

            migrationBuilder.CreateIndex(
                name: "IX_app_end_user_passkeys_organisation_id_app_id",
                table: "app_end_user_passkeys",
                columns: new[] { "organisation_id", "app_id" });

            migrationBuilder.CreateIndex(
                name: "IX_app_end_user_passkeys_organisation_id_end_user_id",
                table: "app_end_user_passkeys",
                columns: new[] { "organisation_id", "end_user_id" });

            migrationBuilder.CreateIndex(
                name: "IX_app_end_users_organisation_id_app_id_email",
                table: "app_end_users",
                columns: new[] { "organisation_id", "app_id", "email" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_app_schedules_next_run_at",
                table: "app_schedules",
                column: "next_run_at");

            migrationBuilder.CreateIndex(
                name: "IX_app_schedules_organisation_id_app_id_name",
                table: "app_schedules",
                columns: new[] { "organisation_id", "app_id", "name" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_app_sessions_organisation_id_app_id",
                table: "app_sessions",
                columns: new[] { "organisation_id", "app_id" });

            migrationBuilder.CreateIndex(
                name: "IX_app_sessions_organisation_id_end_user_id",
                table: "app_sessions",
                columns: new[] { "organisation_id", "end_user_id" });

            migrationBuilder.CreateIndex(
                name: "IX_app_sessions_token_hash",
                table: "app_sessions",
                column: "token_hash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_app_shares_organisation_id_app_id_email",
                table: "app_shares",
                columns: new[] { "organisation_id", "app_id", "email" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_app_tokens_organisation_id_app_id_created_at",
                table: "app_tokens",
                columns: new[] { "organisation_id", "app_id", "created_at" });

            migrationBuilder.CreateIndex(
                name: "IX_app_tokens_token_hash",
                table: "app_tokens",
                column: "token_hash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_app_webhooks_organisation_id_app_id_name",
                table: "app_webhooks",
                columns: new[] { "organisation_id", "app_id", "name" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_email_messages_organisation_id_app_id",
                table: "email_messages",
                columns: new[] { "organisation_id", "app_id" });

            migrationBuilder.CreateIndex(
                name: "IX_email_messages_status_next_attempt_at",
                table: "email_messages",
                columns: new[] { "status", "next_attempt_at" });

            migrationBuilder.CreateIndex(
                name: "IX_hosting_samples_organisation_id_app_id_period_end",
                table: "hosting_samples",
                columns: new[] { "organisation_id", "app_id", "period_end" });

            migrationBuilder.CreateIndex(
                name: "IX_hosting_samples_organisation_id_credit_entry_id",
                table: "hosting_samples",
                columns: new[] { "organisation_id", "credit_entry_id" });

            migrationBuilder.CreateIndex(
                name: "IX_hosting_samples_organisation_id_sample_id",
                table: "hosting_samples",
                columns: new[] { "organisation_id", "sample_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_telemetry_events_organisation_id_app_id_at",
                table: "telemetry_events",
                columns: new[] { "organisation_id", "app_id", "at" });

            migrationBuilder.CreateIndex(
                name: "IX_telemetry_events_received_at",
                table: "telemetry_events",
                column: "received_at");

            migrationBuilder.CreateIndex(
                name: "IX_telemetry_logs_organisation_id_app_id_at",
                table: "telemetry_logs",
                columns: new[] { "organisation_id", "app_id", "at" });

            migrationBuilder.CreateIndex(
                name: "IX_telemetry_logs_received_at",
                table: "telemetry_logs",
                column: "received_at");

            migrationBuilder.CreateIndex(
                name: "IX_telemetry_metrics_organisation_id_app_id_name_at",
                table: "telemetry_metrics",
                columns: new[] { "organisation_id", "app_id", "name", "at" });

            migrationBuilder.CreateIndex(
                name: "IX_telemetry_metrics_received_at",
                table: "telemetry_metrics",
                column: "received_at");

            migrationBuilder.CreateIndex(
                name: "IX_telemetry_spans_organisation_id_app_id_kind_start_at",
                table: "telemetry_spans",
                columns: new[] { "organisation_id", "app_id", "kind", "start_at" });

            migrationBuilder.CreateIndex(
                name: "IX_telemetry_spans_received_at",
                table: "telemetry_spans",
                column: "received_at");

            // Row-level security on every new organisation-scoped table, and hosting samples append-only
            // like the ledger they feed: see TenancySql. The tables are listed here, literally.
            migrationBuilder.Sql(TenancySql.EnableFor(PlatformTables));
            migrationBuilder.Sql(TenancySql.AppendOnlyFor(["hosting_samples"]));
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(TenancySql.DisableFor(PlatformTables));

            migrationBuilder.DropTable(
                name: "app_end_user_passkeys");

            migrationBuilder.DropTable(
                name: "app_schedules");

            migrationBuilder.DropTable(
                name: "app_sessions");

            migrationBuilder.DropTable(
                name: "app_shares");

            migrationBuilder.DropTable(
                name: "app_tokens");

            migrationBuilder.DropTable(
                name: "app_webhooks");

            migrationBuilder.DropTable(
                name: "email_messages");

            migrationBuilder.DropTable(
                name: "hosting_samples");

            migrationBuilder.DropTable(
                name: "telemetry_events");

            migrationBuilder.DropTable(
                name: "telemetry_logs");

            migrationBuilder.DropTable(
                name: "telemetry_metrics");

            migrationBuilder.DropTable(
                name: "telemetry_spans");

            migrationBuilder.DropTable(
                name: "app_end_users");

            migrationBuilder.DropCheckConstraint(
                name: "ck_credit_entries_kind",
                table: "credit_entries");

            migrationBuilder.AddCheckConstraint(
                name: "ck_credit_entries_kind",
                table: "credit_entries",
                sql: "kind IN ('top_up', 'reservation', 'settlement', 'release')");
        }
    }
}
