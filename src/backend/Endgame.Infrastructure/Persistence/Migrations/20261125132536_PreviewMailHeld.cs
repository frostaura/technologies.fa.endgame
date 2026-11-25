using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Endgame.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class PreviewMailHeld : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_email_messages_status",
                table: "email_messages");

            migrationBuilder.AddColumn<bool>(
                name: "preview",
                table: "app_tokens",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddCheckConstraint(
                name: "ck_email_messages_status",
                table: "email_messages",
                sql: "status IN ('queued', 'sending', 'sent', 'failed', 'held')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_email_messages_status",
                table: "email_messages");

            migrationBuilder.DropColumn(
                name: "preview",
                table: "app_tokens");

            migrationBuilder.AddCheckConstraint(
                name: "ck_email_messages_status",
                table: "email_messages",
                sql: "status IN ('queued', 'sending', 'sent', 'failed')");
        }
    }
}
