using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Cantrip.Realms.Server.Data.Migrations.Postgres
{
    /// <inheritdoc />
    public partial class World : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_duels_PlayerId_Map_Spawn_Epoch",
                table: "duels");

            // Where a character stands, a duel was fought and a chest is: a space now (the world, an interior, a run), as the
            // map was.
            migrationBuilder.RenameColumn(
                name: "Map",
                table: "players",
                newName: "Space");

            migrationBuilder.RenameColumn(
                name: "Map",
                table: "duels",
                newName: "Space");

            migrationBuilder.RenameColumn(
                name: "Map",
                table: "chests",
                newName: "Space");

            migrationBuilder.AlterColumn<string>(
                name: "Space",
                table: "players",
                type: "character varying(80)",
                maxLength: 80,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(64)",
                oldMaxLength: 64);

            migrationBuilder.AlterColumn<string>(
                name: "Space",
                table: "duels",
                type: "character varying(80)",
                maxLength: 80,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "text");

            migrationBuilder.AddColumn<long>(
                name: "PlacedAt",
                table: "players",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<string>(
                name: "Inn",
                table: "players",
                type: "character varying(64)",
                maxLength: 64,
                nullable: false,
                defaultValue: "");

            migrationBuilder.CreateTable(
                name: "attuned",
                columns: table => new
                {
                    PlayerId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Tower = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    At = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_attuned", x => new { x.PlayerId, x.Tower });
                });

            migrationBuilder.CreateTable(
                name: "runs",
                columns: table => new
                {
                    Id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    PlayerId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Dungeon = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Seed = table.Column<long>(type: "bigint", nullable: false),
                    Floors = table.Column<string>(type: "text", nullable: false),
                    Floor = table.Column<int>(type: "integer", nullable: false),
                    State = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    StartedAt = table.Column<long>(type: "bigint", nullable: false),
                    EndedAt = table.Column<long>(type: "bigint", nullable: true),
                    Detail = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_runs", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_duels_PlayerId_Space_Spawn_Epoch",
                table: "duels",
                columns: new[] { "PlayerId", "Space", "Spawn", "Epoch" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_runs_PlayerId_State",
                table: "runs",
                columns: new[] { "PlayerId", "State" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "attuned");

            migrationBuilder.DropTable(
                name: "runs");

            migrationBuilder.DropIndex(
                name: "IX_duels_PlayerId_Space_Spawn_Epoch",
                table: "duels");

            migrationBuilder.DropColumn(
                name: "PlacedAt",
                table: "players");

            migrationBuilder.DropColumn(
                name: "Inn",
                table: "players");

            migrationBuilder.AlterColumn<string>(
                name: "Space",
                table: "players",
                type: "character varying(64)",
                maxLength: 64,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(80)",
                oldMaxLength: 80);

            migrationBuilder.AlterColumn<string>(
                name: "Space",
                table: "duels",
                type: "text",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(80)",
                oldMaxLength: 80);

            migrationBuilder.RenameColumn(
                name: "Space",
                table: "players",
                newName: "Map");

            migrationBuilder.RenameColumn(
                name: "Space",
                table: "duels",
                newName: "Map");

            migrationBuilder.RenameColumn(
                name: "Space",
                table: "chests",
                newName: "Map");

            migrationBuilder.CreateIndex(
                name: "IX_duels_PlayerId_Map_Spawn_Epoch",
                table: "duels",
                columns: new[] { "PlayerId", "Map", "Spawn", "Epoch" },
                unique: true);
        }
    }
}
