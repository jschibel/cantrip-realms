using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Cantrip.Realms.Server.Data.Migrations.Sqlite
{
    /// <inheritdoc />
    public partial class Relics : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "relics",
                columns: table => new
                {
                    PlayerId = table.Column<string>(type: "TEXT", maxLength: 64, nullable: false),
                    Card = table.Column<string>(type: "TEXT", maxLength: 160, nullable: false),
                    At = table.Column<long>(type: "INTEGER", nullable: false),
                    Duel = table.Column<string>(type: "TEXT", maxLength: 64, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_relics", x => new { x.PlayerId, x.Card });
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "relics");
        }
    }
}
