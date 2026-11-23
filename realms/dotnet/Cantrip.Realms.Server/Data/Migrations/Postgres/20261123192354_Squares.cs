using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Cantrip.Realms.Server.Data.Migrations.Postgres
{
    /// <inheritdoc />
    public partial class Squares : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Where a character stands is a square tile now, x and z, where it was an axial hex, q and r. A hex of the world
            // or an interior names no tile, so a place outside a dungeon run becomes a place the content no longer has: the
            // character's next report may be any open tile (interfaces.md, "Places"), as after an old map's id.
            migrationBuilder.Sql("UPDATE players SET \"Space\" = '', \"Q\" = 0, \"R\" = 0 WHERE \"Space\" NOT LIKE 'run:%';");

            migrationBuilder.RenameColumn(
                name: "R",
                table: "players",
                newName: "Z");

            migrationBuilder.RenameColumn(
                name: "Q",
                table: "players",
                newName: "X");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.RenameColumn(
                name: "Z",
                table: "players",
                newName: "R");

            migrationBuilder.RenameColumn(
                name: "X",
                table: "players",
                newName: "Q");
        }
    }
}
