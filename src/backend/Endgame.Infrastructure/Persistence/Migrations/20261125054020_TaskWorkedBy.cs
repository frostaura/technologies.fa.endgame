using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Endgame.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Who did a task: the employee who claimed it last, kept when the task finishes (the holder is cleared then), so a
    /// factory build's items stay the engineer's work. Row-level security on tasks is unchanged (the column is a value of
    /// the same row).
    /// </summary>
    public partial class TaskWorkedBy : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "employee_id",
                table: "tasks",
                type: "uuid",
                nullable: true);

            migrationBuilder.Sql("UPDATE tasks SET employee_id = holder_employee_id WHERE holder_employee_id IS NOT NULL;");

            migrationBuilder.CreateIndex(
                name: "IX_tasks_organisation_id_employee_id",
                table: "tasks",
                columns: new[] { "organisation_id", "employee_id" });

            migrationBuilder.AddForeignKey(
                name: "FK_tasks_employees_organisation_id_employee_id",
                table: "tasks",
                columns: new[] { "organisation_id", "employee_id" },
                principalTable: "employees",
                principalColumns: new[] { "organisation_id", "id" },
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_tasks_employees_organisation_id_employee_id",
                table: "tasks");

            migrationBuilder.DropIndex(
                name: "IX_tasks_organisation_id_employee_id",
                table: "tasks");

            migrationBuilder.DropColumn(
                name: "employee_id",
                table: "tasks");
        }
    }
}
