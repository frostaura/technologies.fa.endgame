using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Endgame.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ControlPlaneCore : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_apps_projects_project_id",
                table: "apps");

            migrationBuilder.DropForeignKey(
                name: "FK_projects_divisions_division_id",
                table: "projects");

            migrationBuilder.AlterColumn<string>(
                name: "slug",
                table: "projects",
                type: "character varying(40)",
                maxLength: 40,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(63)",
                oldMaxLength: 63);

            migrationBuilder.AddColumn<Guid>(
                name: "organisation_id",
                table: "projects",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.AddColumn<string>(
                name: "status",
                table: "projects",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AlterColumn<string>(
                name: "slug",
                table: "organisations",
                type: "character varying(40)",
                maxLength: 40,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(63)",
                oldMaxLength: 63);

            migrationBuilder.AddColumn<Guid>(
                name: "organisation_id",
                table: "organisations",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.AddColumn<string>(
                name: "status",
                table: "organisations",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AlterColumn<string>(
                name: "slug",
                table: "divisions",
                type: "character varying(40)",
                maxLength: 40,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(63)",
                oldMaxLength: 63);

            migrationBuilder.AddColumn<string>(
                name: "status",
                table: "divisions",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AlterColumn<string>(
                name: "slug",
                table: "apps",
                type: "character varying(40)",
                maxLength: 40,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(63)",
                oldMaxLength: 63);

            migrationBuilder.AddColumn<string>(
                name: "current_version",
                table: "apps",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "organisation_id",
                table: "apps",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "published_at",
                table: "apps",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "status",
                table: "apps",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddUniqueConstraint(
                name: "AK_projects_organisation_id_division_id_id",
                table: "projects",
                columns: new[] { "organisation_id", "division_id", "id" });

            migrationBuilder.AddUniqueConstraint(
                name: "AK_projects_organisation_id_id",
                table: "projects",
                columns: new[] { "organisation_id", "id" });

            migrationBuilder.AddUniqueConstraint(
                name: "AK_divisions_organisation_id_id",
                table: "divisions",
                columns: new[] { "organisation_id", "id" });

            migrationBuilder.AddUniqueConstraint(
                name: "AK_apps_organisation_id_id",
                table: "apps",
                columns: new[] { "organisation_id", "id" });

            migrationBuilder.AddUniqueConstraint(
                name: "AK_apps_organisation_id_project_id_id",
                table: "apps",
                columns: new[] { "organisation_id", "project_id", "id" });

            migrationBuilder.CreateTable(
                name: "cascade_entries",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    organisation_id = table.Column<Guid>(type: "uuid", nullable: false),
                    division_id = table.Column<Guid>(type: "uuid", nullable: true),
                    project_id = table.Column<Guid>(type: "uuid", nullable: true),
                    app_id = table.Column<Guid>(type: "uuid", nullable: true),
                    kind = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    key = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    value = table.Column<string>(type: "jsonb", nullable: false),
                    protected_value = table.Column<string>(type: "text", nullable: true),
                    set_by = table.Column<Guid>(type: "uuid", nullable: true),
                    set_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_cascade_entries", x => x.id);
                    table.CheckConstraint("ck_cascade_entries_kind", "kind IN ('secret', 'budget', 'rule_set', 'context', 'setting')");
                    table.CheckConstraint("ck_cascade_entries_path", "(app_id IS NULL OR project_id IS NOT NULL) AND (project_id IS NULL OR division_id IS NOT NULL)");
                    table.CheckConstraint("ck_cascade_entries_secret", "(kind = 'secret') = (protected_value IS NOT NULL)");
                    table.ForeignKey(
                        name: "FK_cascade_entries_apps_organisation_id_project_id_app_id",
                        columns: x => new { x.organisation_id, x.project_id, x.app_id },
                        principalTable: "apps",
                        principalColumns: new[] { "organisation_id", "project_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_cascade_entries_divisions_organisation_id_division_id",
                        columns: x => new { x.organisation_id, x.division_id },
                        principalTable: "divisions",
                        principalColumns: new[] { "organisation_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_cascade_entries_organisations_organisation_id",
                        column: x => x.organisation_id,
                        principalTable: "organisations",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_cascade_entries_projects_organisation_id_division_id_projec~",
                        columns: x => new { x.organisation_id, x.division_id, x.project_id },
                        principalTable: "projects",
                        principalColumns: new[] { "organisation_id", "division_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "data_protection_keys",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    FriendlyName = table.Column<string>(type: "text", nullable: true),
                    Xml = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_data_protection_keys", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "employees",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    organisation_id = table.Column<Guid>(type: "uuid", nullable: false),
                    division_id = table.Column<Guid>(type: "uuid", nullable: true),
                    project_id = table.Column<Guid>(type: "uuid", nullable: true),
                    app_id = table.Column<Guid>(type: "uuid", nullable: true),
                    name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    role = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    job_description = table.Column<string>(type: "text", nullable: false),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    monthly_credit_limit = table.Column<decimal>(type: "numeric(20,6)", precision: 20, scale: 6, nullable: true),
                    runs_finished = table.Column<int>(type: "integer", nullable: false),
                    runs_succeeded = table.Column<int>(type: "integer", nullable: false),
                    current_run_id = table.Column<Guid>(type: "uuid", nullable: true),
                    last_run_id = table.Column<Guid>(type: "uuid", nullable: true),
                    last_active_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_employees", x => x.id);
                    table.UniqueConstraint("AK_employees_organisation_id_id", x => new { x.organisation_id, x.id });
                    table.CheckConstraint("ck_employees_limit", "monthly_credit_limit IS NULL OR monthly_credit_limit >= 0");
                    table.CheckConstraint("ck_employees_path", "(app_id IS NULL OR project_id IS NOT NULL) AND (project_id IS NULL OR division_id IS NOT NULL)");
                    table.CheckConstraint("ck_employees_status", "status IN ('idle', 'working', 'paused', 'released')");
                    table.ForeignKey(
                        name: "FK_employees_apps_organisation_id_project_id_app_id",
                        columns: x => new { x.organisation_id, x.project_id, x.app_id },
                        principalTable: "apps",
                        principalColumns: new[] { "organisation_id", "project_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_employees_divisions_organisation_id_division_id",
                        columns: x => new { x.organisation_id, x.division_id },
                        principalTable: "divisions",
                        principalColumns: new[] { "organisation_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_employees_organisations_organisation_id",
                        column: x => x.organisation_id,
                        principalTable: "organisations",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_employees_projects_organisation_id_division_id_project_id",
                        columns: x => new { x.organisation_id, x.division_id, x.project_id },
                        principalTable: "projects",
                        principalColumns: new[] { "organisation_id", "division_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "operator_actions",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    organisation_id = table.Column<Guid>(type: "uuid", nullable: false),
                    operator_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    action = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    detail = table.Column<string>(type: "jsonb", nullable: false),
                    at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_operator_actions", x => x.id);
                    table.ForeignKey(
                        name: "FK_operator_actions_organisations_organisation_id",
                        column: x => x.organisation_id,
                        principalTable: "organisations",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "users",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    display_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    invitation_code_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    invitation_expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    UserName = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    NormalizedUserName = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    Email = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    NormalizedEmail = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    EmailConfirmed = table.Column<bool>(type: "boolean", nullable: false),
                    PasswordHash = table.Column<string>(type: "text", nullable: true),
                    SecurityStamp = table.Column<string>(type: "text", nullable: true),
                    ConcurrencyStamp = table.Column<string>(type: "text", nullable: true),
                    PhoneNumber = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    PhoneNumberConfirmed = table.Column<bool>(type: "boolean", nullable: false),
                    TwoFactorEnabled = table.Column<bool>(type: "boolean", nullable: false),
                    LockoutEnd = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    LockoutEnabled = table.Column<bool>(type: "boolean", nullable: false),
                    AccessFailedCount = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_users", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "conversations",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    organisation_id = table.Column<Guid>(type: "uuid", nullable: false),
                    division_id = table.Column<Guid>(type: "uuid", nullable: true),
                    project_id = table.Column<Guid>(type: "uuid", nullable: true),
                    app_id = table.Column<Guid>(type: "uuid", nullable: true),
                    employee_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_by = table.Column<Guid>(type: "uuid", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    last_run_id = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_conversations", x => x.id);
                    table.UniqueConstraint("AK_conversations_organisation_id_id", x => new { x.organisation_id, x.id });
                    table.CheckConstraint("ck_conversations_path", "(app_id IS NULL OR project_id IS NOT NULL) AND (project_id IS NULL OR division_id IS NOT NULL)");
                    table.ForeignKey(
                        name: "FK_conversations_apps_organisation_id_project_id_app_id",
                        columns: x => new { x.organisation_id, x.project_id, x.app_id },
                        principalTable: "apps",
                        principalColumns: new[] { "organisation_id", "project_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_conversations_divisions_organisation_id_division_id",
                        columns: x => new { x.organisation_id, x.division_id },
                        principalTable: "divisions",
                        principalColumns: new[] { "organisation_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_conversations_employees_organisation_id_employee_id",
                        columns: x => new { x.organisation_id, x.employee_id },
                        principalTable: "employees",
                        principalColumns: new[] { "organisation_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_conversations_organisations_organisation_id",
                        column: x => x.organisation_id,
                        principalTable: "organisations",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_conversations_projects_organisation_id_division_id_project_~",
                        columns: x => new { x.organisation_id, x.division_id, x.project_id },
                        principalTable: "projects",
                        principalColumns: new[] { "organisation_id", "division_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "memberships",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    organisation_id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    division_id = table.Column<Guid>(type: "uuid", nullable: true),
                    project_id = table.Column<Guid>(type: "uuid", nullable: true),
                    app_id = table.Column<Guid>(type: "uuid", nullable: true),
                    role = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    granted_by = table.Column<Guid>(type: "uuid", nullable: true),
                    granted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_memberships", x => x.id);
                    table.CheckConstraint("ck_memberships_path", "(app_id IS NULL OR project_id IS NOT NULL) AND (project_id IS NULL OR division_id IS NOT NULL)");
                    table.CheckConstraint("ck_memberships_role", "role IN ('owner', 'admin', 'builder', 'viewer')");
                    table.ForeignKey(
                        name: "FK_memberships_apps_organisation_id_project_id_app_id",
                        columns: x => new { x.organisation_id, x.project_id, x.app_id },
                        principalTable: "apps",
                        principalColumns: new[] { "organisation_id", "project_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_memberships_divisions_organisation_id_division_id",
                        columns: x => new { x.organisation_id, x.division_id },
                        principalTable: "divisions",
                        principalColumns: new[] { "organisation_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_memberships_organisations_organisation_id",
                        column: x => x.organisation_id,
                        principalTable: "organisations",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_memberships_projects_organisation_id_division_id_project_id",
                        columns: x => new { x.organisation_id, x.division_id, x.project_id },
                        principalTable: "projects",
                        principalColumns: new[] { "organisation_id", "division_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_memberships_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "user_claims",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    ClaimType = table.Column<string>(type: "text", nullable: true),
                    ClaimValue = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_user_claims", x => x.Id);
                    table.ForeignKey(
                        name: "FK_user_claims_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "user_logins",
                columns: table => new
                {
                    LoginProvider = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    ProviderKey = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    ProviderDisplayName = table.Column<string>(type: "text", nullable: true),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_user_logins", x => new { x.LoginProvider, x.ProviderKey });
                    table.ForeignKey(
                        name: "FK_user_logins_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "user_passkeys",
                columns: table => new
                {
                    CredentialId = table.Column<byte[]>(type: "bytea", maxLength: 1024, nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Data = table.Column<string>(type: "jsonb", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_user_passkeys", x => x.CredentialId);
                    table.ForeignKey(
                        name: "FK_user_passkeys_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "user_tokens",
                columns: table => new
                {
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    LoginProvider = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    Name = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    Value = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_user_tokens", x => new { x.UserId, x.LoginProvider, x.Name });
                    table.ForeignKey(
                        name: "FK_user_tokens_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "approvals",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    organisation_id = table.Column<Guid>(type: "uuid", nullable: false),
                    run_id = table.Column<Guid>(type: "uuid", nullable: false),
                    title = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    detail = table.Column<string>(type: "text", nullable: false),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    requested_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    answered_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    answered_by = table.Column<Guid>(type: "uuid", nullable: true),
                    comment = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_approvals", x => x.id);
                    table.CheckConstraint("ck_approvals_answered", "(status = 'pending') = (answered_at IS NULL)");
                    table.CheckConstraint("ck_approvals_status", "status IN ('pending', 'approved', 'rejected')");
                });

            migrationBuilder.CreateTable(
                name: "credit_entries",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    organisation_id = table.Column<Guid>(type: "uuid", nullable: false),
                    kind = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    amount = table.Column<decimal>(type: "numeric(20,6)", precision: 20, scale: 6, nullable: false),
                    reservation_id = table.Column<Guid>(type: "uuid", nullable: true),
                    division_id = table.Column<Guid>(type: "uuid", nullable: true),
                    project_id = table.Column<Guid>(type: "uuid", nullable: true),
                    app_id = table.Column<Guid>(type: "uuid", nullable: true),
                    employee_id = table.Column<Guid>(type: "uuid", nullable: true),
                    run_id = table.Column<Guid>(type: "uuid", nullable: true),
                    task_type = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: true),
                    model = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    billable = table.Column<bool>(type: "boolean", nullable: false),
                    cost_usd = table.Column<decimal>(type: "numeric(20,10)", precision: 20, scale: 10, nullable: true),
                    generation_id = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    idempotency_key = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    note = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    created_by = table.Column<Guid>(type: "uuid", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_credit_entries", x => x.id);
                    table.UniqueConstraint("AK_credit_entries_organisation_id_id", x => new { x.organisation_id, x.id });
                    table.CheckConstraint("ck_credit_entries_amount", "amount >= 0");
                    table.CheckConstraint("ck_credit_entries_kind", "kind IN ('top_up', 'reservation', 'settlement', 'release')");
                    table.CheckConstraint("ck_credit_entries_path", "(app_id IS NULL OR project_id IS NOT NULL) AND (project_id IS NULL OR division_id IS NOT NULL)");
                    table.CheckConstraint("ck_credit_entries_reservation", "(kind = 'reservation') = (expires_at IS NOT NULL) AND (kind IN ('settlement', 'release')) = (reservation_id IS NOT NULL)");
                    table.CheckConstraint("ck_credit_entries_top_up", "kind <> 'top_up' OR (division_id IS NULL AND billable)");
                    table.ForeignKey(
                        name: "FK_credit_entries_apps_organisation_id_project_id_app_id",
                        columns: x => new { x.organisation_id, x.project_id, x.app_id },
                        principalTable: "apps",
                        principalColumns: new[] { "organisation_id", "project_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_credit_entries_credit_entries_organisation_id_reservation_id",
                        columns: x => new { x.organisation_id, x.reservation_id },
                        principalTable: "credit_entries",
                        principalColumns: new[] { "organisation_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_credit_entries_divisions_organisation_id_division_id",
                        columns: x => new { x.organisation_id, x.division_id },
                        principalTable: "divisions",
                        principalColumns: new[] { "organisation_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_credit_entries_employees_organisation_id_employee_id",
                        columns: x => new { x.organisation_id, x.employee_id },
                        principalTable: "employees",
                        principalColumns: new[] { "organisation_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_credit_entries_organisations_organisation_id",
                        column: x => x.organisation_id,
                        principalTable: "organisations",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_credit_entries_projects_organisation_id_division_id_project~",
                        columns: x => new { x.organisation_id, x.division_id, x.project_id },
                        principalTable: "projects",
                        principalColumns: new[] { "organisation_id", "division_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ideas",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    organisation_id = table.Column<Guid>(type: "uuid", nullable: false),
                    division_id = table.Column<Guid>(type: "uuid", nullable: true),
                    project_id = table.Column<Guid>(type: "uuid", nullable: true),
                    app_id = table.Column<Guid>(type: "uuid", nullable: true),
                    text = table.Column<string>(type: "text", nullable: false),
                    constraints = table.Column<string>(type: "text", nullable: false),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    research_estimate_credits = table.Column<decimal>(type: "numeric(20,6)", precision: 20, scale: 6, nullable: false),
                    verdict = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    verdict_summary = table.Column<string>(type: "text", nullable: true),
                    verdict_evidence = table.Column<string>(type: "jsonb", nullable: true),
                    overruled = table.Column<bool>(type: "boolean", nullable: false),
                    decision = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    decision_note = table.Column<string>(type: "text", nullable: true),
                    decided_by = table.Column<Guid>(type: "uuid", nullable: true),
                    decided_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    research_run_id = table.Column<Guid>(type: "uuid", nullable: true),
                    build_run_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_by = table.Column<Guid>(type: "uuid", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ideas", x => x.id);
                    table.UniqueConstraint("AK_ideas_organisation_id_id", x => new { x.organisation_id, x.id });
                    table.CheckConstraint("ck_ideas_decision", "decision IS NULL OR decision IN ('build', 'change', 'overrule', 'drop')");
                    table.CheckConstraint("ck_ideas_path", "(app_id IS NULL OR project_id IS NOT NULL) AND (project_id IS NULL OR division_id IS NOT NULL)");
                    table.CheckConstraint("ck_ideas_status", "status IN ('researching', 'awaiting_decision', 'building', 'dropped')");
                    table.CheckConstraint("ck_ideas_verdict", "verdict IS NULL OR verdict IN ('build', 'change', 'do-not-build')");
                    table.ForeignKey(
                        name: "FK_ideas_apps_organisation_id_project_id_app_id",
                        columns: x => new { x.organisation_id, x.project_id, x.app_id },
                        principalTable: "apps",
                        principalColumns: new[] { "organisation_id", "project_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ideas_divisions_organisation_id_division_id",
                        columns: x => new { x.organisation_id, x.division_id },
                        principalTable: "divisions",
                        principalColumns: new[] { "organisation_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ideas_organisations_organisation_id",
                        column: x => x.organisation_id,
                        principalTable: "organisations",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ideas_projects_organisation_id_division_id_project_id",
                        columns: x => new { x.organisation_id, x.division_id, x.project_id },
                        principalTable: "projects",
                        principalColumns: new[] { "organisation_id", "division_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "runs",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    organisation_id = table.Column<Guid>(type: "uuid", nullable: false),
                    division_id = table.Column<Guid>(type: "uuid", nullable: true),
                    project_id = table.Column<Guid>(type: "uuid", nullable: true),
                    app_id = table.Column<Guid>(type: "uuid", nullable: true),
                    kind = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    title = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    employee_id = table.Column<Guid>(type: "uuid", nullable: true),
                    idea_id = table.Column<Guid>(type: "uuid", nullable: true),
                    conversation_id = table.Column<Guid>(type: "uuid", nullable: true),
                    parent_run_id = table.Column<Guid>(type: "uuid", nullable: true),
                    lease_holder = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    lease_expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    last_seq = table.Column<long>(type: "bigint", nullable: false),
                    budget_exhausted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    outcome = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    summary = table.Column<string>(type: "text", nullable: true),
                    created_by = table.Column<Guid>(type: "uuid", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    started_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    finished_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_runs", x => x.id);
                    table.UniqueConstraint("AK_runs_organisation_id_id", x => new { x.organisation_id, x.id });
                    table.CheckConstraint("ck_runs_finished", "(status IN ('succeeded', 'failed', 'cancelled')) = (finished_at IS NOT NULL)");
                    table.CheckConstraint("ck_runs_kind", "kind IN ('research', 'conversation', 'build', 'task', 'review')");
                    table.CheckConstraint("ck_runs_path", "(app_id IS NULL OR project_id IS NOT NULL) AND (project_id IS NULL OR division_id IS NOT NULL)");
                    table.CheckConstraint("ck_runs_seq", "last_seq >= 0");
                    table.CheckConstraint("ck_runs_status", "status IN ('queued', 'running', 'paused', 'waiting_approval', 'succeeded', 'failed', 'cancelled')");
                    table.ForeignKey(
                        name: "FK_runs_apps_organisation_id_project_id_app_id",
                        columns: x => new { x.organisation_id, x.project_id, x.app_id },
                        principalTable: "apps",
                        principalColumns: new[] { "organisation_id", "project_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_runs_conversations_organisation_id_conversation_id",
                        columns: x => new { x.organisation_id, x.conversation_id },
                        principalTable: "conversations",
                        principalColumns: new[] { "organisation_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_runs_divisions_organisation_id_division_id",
                        columns: x => new { x.organisation_id, x.division_id },
                        principalTable: "divisions",
                        principalColumns: new[] { "organisation_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_runs_employees_organisation_id_employee_id",
                        columns: x => new { x.organisation_id, x.employee_id },
                        principalTable: "employees",
                        principalColumns: new[] { "organisation_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_runs_ideas_organisation_id_idea_id",
                        columns: x => new { x.organisation_id, x.idea_id },
                        principalTable: "ideas",
                        principalColumns: new[] { "organisation_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_runs_organisations_organisation_id",
                        column: x => x.organisation_id,
                        principalTable: "organisations",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_runs_projects_organisation_id_division_id_project_id",
                        columns: x => new { x.organisation_id, x.division_id, x.project_id },
                        principalTable: "projects",
                        principalColumns: new[] { "organisation_id", "division_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_runs_runs_organisation_id_parent_run_id",
                        columns: x => new { x.organisation_id, x.parent_run_id },
                        principalTable: "runs",
                        principalColumns: new[] { "organisation_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "run_events",
                columns: table => new
                {
                    organisation_id = table.Column<Guid>(type: "uuid", nullable: false),
                    run_id = table.Column<Guid>(type: "uuid", nullable: false),
                    seq = table.Column<long>(type: "bigint", nullable: false),
                    type = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    payload = table.Column<string>(type: "jsonb", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_run_events", x => new { x.organisation_id, x.run_id, x.seq });
                    table.CheckConstraint("ck_run_events_seq", "seq >= 1");
                    table.CheckConstraint("ck_run_events_type", "type IN ('run.started', 'run.paused', 'run.resumed', 'run.finished', 'plan.proposed', 'plan.accepted', 'task.created', 'task.claimed', 'task.done', 'task.failed', 'model.requested', 'model.replied', 'tool.requested', 'tool.permitted', 'tool.denied', 'tool.result', 'subagent.started', 'subagent.finished', 'approval.requested', 'approval.answered', 'evaluation.passed', 'evaluation.failed', 'estimate.made', 'estimate.scored', 'message')");
                    table.ForeignKey(
                        name: "FK_run_events_runs_organisation_id_run_id",
                        columns: x => new { x.organisation_id, x.run_id },
                        principalTable: "runs",
                        principalColumns: new[] { "organisation_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "tasks",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    organisation_id = table.Column<Guid>(type: "uuid", nullable: false),
                    division_id = table.Column<Guid>(type: "uuid", nullable: true),
                    project_id = table.Column<Guid>(type: "uuid", nullable: true),
                    app_id = table.Column<Guid>(type: "uuid", nullable: true),
                    run_id = table.Column<Guid>(type: "uuid", nullable: true),
                    parent_task_id = table.Column<Guid>(type: "uuid", nullable: true),
                    title = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    description = table.Column<string>(type: "text", nullable: false),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    holder_run_id = table.Column<Guid>(type: "uuid", nullable: true),
                    holder_employee_id = table.Column<Guid>(type: "uuid", nullable: true),
                    claimed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    estimate_credits = table.Column<decimal>(type: "numeric(20,6)", precision: 20, scale: 6, nullable: true),
                    actual_credits = table.Column<decimal>(type: "numeric(20,6)", precision: 20, scale: 6, nullable: true),
                    depends_on = table.Column<Guid[]>(type: "uuid[]", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_tasks", x => x.id);
                    table.UniqueConstraint("AK_tasks_organisation_id_id", x => new { x.organisation_id, x.id });
                    table.CheckConstraint("ck_tasks_holder", "(status = 'in_progress') = (holder_run_id IS NOT NULL)");
                    table.CheckConstraint("ck_tasks_path", "(app_id IS NULL OR project_id IS NOT NULL) AND (project_id IS NULL OR division_id IS NOT NULL)");
                    table.CheckConstraint("ck_tasks_status", "status IN ('todo', 'in_progress', 'blocked', 'done', 'failed', 'cancelled')");
                    table.ForeignKey(
                        name: "FK_tasks_apps_organisation_id_project_id_app_id",
                        columns: x => new { x.organisation_id, x.project_id, x.app_id },
                        principalTable: "apps",
                        principalColumns: new[] { "organisation_id", "project_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_tasks_divisions_organisation_id_division_id",
                        columns: x => new { x.organisation_id, x.division_id },
                        principalTable: "divisions",
                        principalColumns: new[] { "organisation_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_tasks_employees_organisation_id_holder_employee_id",
                        columns: x => new { x.organisation_id, x.holder_employee_id },
                        principalTable: "employees",
                        principalColumns: new[] { "organisation_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_tasks_organisations_organisation_id",
                        column: x => x.organisation_id,
                        principalTable: "organisations",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_tasks_projects_organisation_id_division_id_project_id",
                        columns: x => new { x.organisation_id, x.division_id, x.project_id },
                        principalTable: "projects",
                        principalColumns: new[] { "organisation_id", "division_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_tasks_runs_organisation_id_holder_run_id",
                        columns: x => new { x.organisation_id, x.holder_run_id },
                        principalTable: "runs",
                        principalColumns: new[] { "organisation_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_tasks_runs_organisation_id_run_id",
                        columns: x => new { x.organisation_id, x.run_id },
                        principalTable: "runs",
                        principalColumns: new[] { "organisation_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_tasks_tasks_organisation_id_parent_task_id",
                        columns: x => new { x.organisation_id, x.parent_task_id },
                        principalTable: "tasks",
                        principalColumns: new[] { "organisation_id", "id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.AddCheckConstraint(
                name: "ck_projects_slug",
                table: "projects",
                sql: "slug ~ '^(?=.{2,40}$)[a-z0-9]+(-[a-z0-9]+)*$'");

            migrationBuilder.AddCheckConstraint(
                name: "ck_projects_status",
                table: "projects",
                sql: "status IN ('active', 'archived')");

            migrationBuilder.AddCheckConstraint(
                name: "ck_organisations_self",
                table: "organisations",
                sql: "organisation_id = id");

            migrationBuilder.AddCheckConstraint(
                name: "ck_organisations_slug",
                table: "organisations",
                sql: "slug ~ '^(?=.{2,40}$)[a-z0-9]+(-[a-z0-9]+)*$'");

            migrationBuilder.AddCheckConstraint(
                name: "ck_organisations_status",
                table: "organisations",
                sql: "status IN ('active', 'suspended')");

            migrationBuilder.AddCheckConstraint(
                name: "ck_divisions_slug",
                table: "divisions",
                sql: "slug ~ '^(?=.{2,40}$)[a-z0-9]+(-[a-z0-9]+)*$'");

            migrationBuilder.AddCheckConstraint(
                name: "ck_divisions_status",
                table: "divisions",
                sql: "status IN ('active', 'archived')");

            migrationBuilder.AddCheckConstraint(
                name: "ck_apps_slug",
                table: "apps",
                sql: "slug ~ '^(?=.{2,40}$)[a-z0-9]+(-[a-z0-9]+)*$'");

            migrationBuilder.AddCheckConstraint(
                name: "ck_apps_status",
                table: "apps",
                sql: "status IN ('draft', 'building', 'running', 'sleeping', 'stopped', 'failed', 'archived')");

            migrationBuilder.CreateIndex(
                name: "IX_approvals_organisation_id_run_id",
                table: "approvals",
                columns: new[] { "organisation_id", "run_id" });

            migrationBuilder.CreateIndex(
                name: "IX_cascade_entries_organisation_id_division_id_project_id_app_~",
                table: "cascade_entries",
                columns: new[] { "organisation_id", "division_id", "project_id", "app_id", "kind", "key" },
                unique: true)
                .Annotation("Npgsql:NullsDistinct", false);

            migrationBuilder.CreateIndex(
                name: "IX_cascade_entries_organisation_id_project_id_app_id",
                table: "cascade_entries",
                columns: new[] { "organisation_id", "project_id", "app_id" });

            migrationBuilder.CreateIndex(
                name: "IX_conversations_organisation_id_division_id_project_id",
                table: "conversations",
                columns: new[] { "organisation_id", "division_id", "project_id" });

            migrationBuilder.CreateIndex(
                name: "IX_conversations_organisation_id_employee_id",
                table: "conversations",
                columns: new[] { "organisation_id", "employee_id" });

            migrationBuilder.CreateIndex(
                name: "IX_conversations_organisation_id_project_id_app_id",
                table: "conversations",
                columns: new[] { "organisation_id", "project_id", "app_id" });

            migrationBuilder.CreateIndex(
                name: "IX_credit_entries_organisation_id_division_id_project_id",
                table: "credit_entries",
                columns: new[] { "organisation_id", "division_id", "project_id" });

            migrationBuilder.CreateIndex(
                name: "IX_credit_entries_organisation_id_employee_id",
                table: "credit_entries",
                columns: new[] { "organisation_id", "employee_id" });

            migrationBuilder.CreateIndex(
                name: "IX_credit_entries_organisation_id_idempotency_key",
                table: "credit_entries",
                columns: new[] { "organisation_id", "idempotency_key" },
                unique: true,
                filter: "idempotency_key IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_credit_entries_organisation_id_kind_created_at",
                table: "credit_entries",
                columns: new[] { "organisation_id", "kind", "created_at" });

            migrationBuilder.CreateIndex(
                name: "IX_credit_entries_organisation_id_project_id_app_id",
                table: "credit_entries",
                columns: new[] { "organisation_id", "project_id", "app_id" });

            migrationBuilder.CreateIndex(
                name: "IX_credit_entries_organisation_id_reservation_id_kind",
                table: "credit_entries",
                columns: new[] { "organisation_id", "reservation_id", "kind" },
                unique: true,
                filter: "reservation_id IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_credit_entries_organisation_id_run_id",
                table: "credit_entries",
                columns: new[] { "organisation_id", "run_id" });

            migrationBuilder.CreateIndex(
                name: "IX_credit_entries_run_id",
                table: "credit_entries",
                column: "run_id");

            migrationBuilder.CreateIndex(
                name: "IX_employees_organisation_id_division_id_project_id",
                table: "employees",
                columns: new[] { "organisation_id", "division_id", "project_id" });

            migrationBuilder.CreateIndex(
                name: "IX_employees_organisation_id_project_id_app_id",
                table: "employees",
                columns: new[] { "organisation_id", "project_id", "app_id" });

            migrationBuilder.CreateIndex(
                name: "IX_ideas_organisation_id_build_run_id",
                table: "ideas",
                columns: new[] { "organisation_id", "build_run_id" });

            migrationBuilder.CreateIndex(
                name: "IX_ideas_organisation_id_division_id_project_id",
                table: "ideas",
                columns: new[] { "organisation_id", "division_id", "project_id" });

            migrationBuilder.CreateIndex(
                name: "IX_ideas_organisation_id_project_id_app_id",
                table: "ideas",
                columns: new[] { "organisation_id", "project_id", "app_id" });

            migrationBuilder.CreateIndex(
                name: "IX_ideas_organisation_id_research_run_id",
                table: "ideas",
                columns: new[] { "organisation_id", "research_run_id" });

            migrationBuilder.CreateIndex(
                name: "IX_memberships_organisation_id_division_id_project_id",
                table: "memberships",
                columns: new[] { "organisation_id", "division_id", "project_id" });

            migrationBuilder.CreateIndex(
                name: "IX_memberships_organisation_id_project_id_app_id",
                table: "memberships",
                columns: new[] { "organisation_id", "project_id", "app_id" });

            migrationBuilder.CreateIndex(
                name: "IX_memberships_organisation_id_user_id_division_id_project_id_~",
                table: "memberships",
                columns: new[] { "organisation_id", "user_id", "division_id", "project_id", "app_id" },
                unique: true)
                .Annotation("Npgsql:NullsDistinct", false);

            migrationBuilder.CreateIndex(
                name: "IX_memberships_user_id",
                table: "memberships",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "IX_operator_actions_organisation_id",
                table: "operator_actions",
                column: "organisation_id");

            migrationBuilder.CreateIndex(
                name: "IX_runs_organisation_id_conversation_id",
                table: "runs",
                columns: new[] { "organisation_id", "conversation_id" });

            migrationBuilder.CreateIndex(
                name: "IX_runs_organisation_id_division_id_project_id",
                table: "runs",
                columns: new[] { "organisation_id", "division_id", "project_id" });

            migrationBuilder.CreateIndex(
                name: "IX_runs_organisation_id_employee_id",
                table: "runs",
                columns: new[] { "organisation_id", "employee_id" });

            migrationBuilder.CreateIndex(
                name: "IX_runs_organisation_id_idea_id",
                table: "runs",
                columns: new[] { "organisation_id", "idea_id" });

            migrationBuilder.CreateIndex(
                name: "IX_runs_organisation_id_parent_run_id",
                table: "runs",
                columns: new[] { "organisation_id", "parent_run_id" });

            migrationBuilder.CreateIndex(
                name: "IX_runs_organisation_id_project_id_app_id",
                table: "runs",
                columns: new[] { "organisation_id", "project_id", "app_id" });

            migrationBuilder.CreateIndex(
                name: "IX_runs_status_created_at",
                table: "runs",
                columns: new[] { "status", "created_at" });

            migrationBuilder.CreateIndex(
                name: "IX_tasks_organisation_id_division_id_project_id",
                table: "tasks",
                columns: new[] { "organisation_id", "division_id", "project_id" });

            migrationBuilder.CreateIndex(
                name: "IX_tasks_organisation_id_holder_employee_id",
                table: "tasks",
                columns: new[] { "organisation_id", "holder_employee_id" });

            migrationBuilder.CreateIndex(
                name: "IX_tasks_organisation_id_holder_run_id",
                table: "tasks",
                columns: new[] { "organisation_id", "holder_run_id" });

            migrationBuilder.CreateIndex(
                name: "IX_tasks_organisation_id_parent_task_id",
                table: "tasks",
                columns: new[] { "organisation_id", "parent_task_id" });

            migrationBuilder.CreateIndex(
                name: "IX_tasks_organisation_id_project_id_app_id",
                table: "tasks",
                columns: new[] { "organisation_id", "project_id", "app_id" });

            migrationBuilder.CreateIndex(
                name: "IX_tasks_organisation_id_run_id",
                table: "tasks",
                columns: new[] { "organisation_id", "run_id" });

            migrationBuilder.CreateIndex(
                name: "IX_user_claims_UserId",
                table: "user_claims",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_user_logins_UserId",
                table: "user_logins",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_user_passkeys_UserId",
                table: "user_passkeys",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "EmailIndex",
                table: "users",
                column: "NormalizedEmail");

            migrationBuilder.CreateIndex(
                name: "UserNameIndex",
                table: "users",
                column: "NormalizedUserName",
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_apps_projects_organisation_id_project_id",
                table: "apps",
                columns: new[] { "organisation_id", "project_id" },
                principalTable: "projects",
                principalColumns: new[] { "organisation_id", "id" },
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_projects_divisions_organisation_id_division_id",
                table: "projects",
                columns: new[] { "organisation_id", "division_id" },
                principalTable: "divisions",
                principalColumns: new[] { "organisation_id", "id" },
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_approvals_runs_organisation_id_run_id",
                table: "approvals",
                columns: new[] { "organisation_id", "run_id" },
                principalTable: "runs",
                principalColumns: new[] { "organisation_id", "id" },
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_credit_entries_runs_organisation_id_run_id",
                table: "credit_entries",
                columns: new[] { "organisation_id", "run_id" },
                principalTable: "runs",
                principalColumns: new[] { "organisation_id", "id" },
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_ideas_runs_organisation_id_build_run_id",
                table: "ideas",
                columns: new[] { "organisation_id", "build_run_id" },
                principalTable: "runs",
                principalColumns: new[] { "organisation_id", "id" },
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_ideas_runs_organisation_id_research_run_id",
                table: "ideas",
                columns: new[] { "organisation_id", "research_run_id" },
                principalTable: "runs",
                principalColumns: new[] { "organisation_id", "id" },
                onDelete: ReferentialAction.Restrict);

            // Tenancy and append-only enforcement: see TenancySql.
            migrationBuilder.Sql(TenancySql.Up());
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(TenancySql.Down());

            migrationBuilder.DropForeignKey(
                name: "FK_apps_projects_organisation_id_project_id",
                table: "apps");

            migrationBuilder.DropForeignKey(
                name: "FK_projects_divisions_organisation_id_division_id",
                table: "projects");

            migrationBuilder.DropForeignKey(
                name: "FK_ideas_runs_organisation_id_build_run_id",
                table: "ideas");

            migrationBuilder.DropForeignKey(
                name: "FK_ideas_runs_organisation_id_research_run_id",
                table: "ideas");

            migrationBuilder.DropTable(
                name: "approvals");

            migrationBuilder.DropTable(
                name: "cascade_entries");

            migrationBuilder.DropTable(
                name: "credit_entries");

            migrationBuilder.DropTable(
                name: "data_protection_keys");

            migrationBuilder.DropTable(
                name: "memberships");

            migrationBuilder.DropTable(
                name: "operator_actions");

            migrationBuilder.DropTable(
                name: "run_events");

            migrationBuilder.DropTable(
                name: "tasks");

            migrationBuilder.DropTable(
                name: "user_claims");

            migrationBuilder.DropTable(
                name: "user_logins");

            migrationBuilder.DropTable(
                name: "user_passkeys");

            migrationBuilder.DropTable(
                name: "user_tokens");

            migrationBuilder.DropTable(
                name: "users");

            migrationBuilder.DropTable(
                name: "runs");

            migrationBuilder.DropTable(
                name: "conversations");

            migrationBuilder.DropTable(
                name: "ideas");

            migrationBuilder.DropTable(
                name: "employees");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_projects_organisation_id_division_id_id",
                table: "projects");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_projects_organisation_id_id",
                table: "projects");

            migrationBuilder.DropCheckConstraint(
                name: "ck_projects_slug",
                table: "projects");

            migrationBuilder.DropCheckConstraint(
                name: "ck_projects_status",
                table: "projects");

            migrationBuilder.DropCheckConstraint(
                name: "ck_organisations_self",
                table: "organisations");

            migrationBuilder.DropCheckConstraint(
                name: "ck_organisations_slug",
                table: "organisations");

            migrationBuilder.DropCheckConstraint(
                name: "ck_organisations_status",
                table: "organisations");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_divisions_organisation_id_id",
                table: "divisions");

            migrationBuilder.DropCheckConstraint(
                name: "ck_divisions_slug",
                table: "divisions");

            migrationBuilder.DropCheckConstraint(
                name: "ck_divisions_status",
                table: "divisions");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_apps_organisation_id_id",
                table: "apps");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_apps_organisation_id_project_id_id",
                table: "apps");

            migrationBuilder.DropCheckConstraint(
                name: "ck_apps_slug",
                table: "apps");

            migrationBuilder.DropCheckConstraint(
                name: "ck_apps_status",
                table: "apps");

            migrationBuilder.DropColumn(
                name: "organisation_id",
                table: "projects");

            migrationBuilder.DropColumn(
                name: "status",
                table: "projects");

            migrationBuilder.DropColumn(
                name: "organisation_id",
                table: "organisations");

            migrationBuilder.DropColumn(
                name: "status",
                table: "organisations");

            migrationBuilder.DropColumn(
                name: "status",
                table: "divisions");

            migrationBuilder.DropColumn(
                name: "current_version",
                table: "apps");

            migrationBuilder.DropColumn(
                name: "organisation_id",
                table: "apps");

            migrationBuilder.DropColumn(
                name: "published_at",
                table: "apps");

            migrationBuilder.DropColumn(
                name: "status",
                table: "apps");

            migrationBuilder.AlterColumn<string>(
                name: "slug",
                table: "projects",
                type: "character varying(63)",
                maxLength: 63,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(40)",
                oldMaxLength: 40);

            migrationBuilder.AlterColumn<string>(
                name: "slug",
                table: "organisations",
                type: "character varying(63)",
                maxLength: 63,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(40)",
                oldMaxLength: 40);

            migrationBuilder.AlterColumn<string>(
                name: "slug",
                table: "divisions",
                type: "character varying(63)",
                maxLength: 63,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(40)",
                oldMaxLength: 40);

            migrationBuilder.AlterColumn<string>(
                name: "slug",
                table: "apps",
                type: "character varying(63)",
                maxLength: 63,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(40)",
                oldMaxLength: 40);

            migrationBuilder.AddForeignKey(
                name: "FK_apps_projects_project_id",
                table: "apps",
                column: "project_id",
                principalTable: "projects",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_projects_divisions_division_id",
                table: "projects",
                column: "division_id",
                principalTable: "divisions",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);
        }
    }
}
