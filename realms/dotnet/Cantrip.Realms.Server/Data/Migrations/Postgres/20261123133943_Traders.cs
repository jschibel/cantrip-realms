using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Cantrip.Realms.Server.Data.Migrations.Postgres
{
    /// <inheritdoc />
    public partial class Traders : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<long>(
                name: "Visit",
                table: "vendors",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Visit",
                table: "vendors");
        }
    }
}
