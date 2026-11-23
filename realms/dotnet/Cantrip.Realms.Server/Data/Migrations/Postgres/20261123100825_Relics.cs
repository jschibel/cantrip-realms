using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Cantrip.Realms.Server.Data.Migrations.Postgres
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
                    PlayerId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Card = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    At = table.Column<long>(type: "bigint", nullable: false),
                    Duel = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false)
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
