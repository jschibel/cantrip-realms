using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Cantrip.Realms.Server.Data.Migrations.Postgres
{
    /// <inheritdoc />
    public partial class Hearts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ante");

            migrationBuilder.DropIndex(
                name: "IX_duels_PlayerId_Space_Spawn_Epoch",
                table: "duels");

            migrationBuilder.DropColumn(
                name: "AnteValue",
                table: "duels");

            migrationBuilder.DropColumn(
                name: "Cap",
                table: "duels");

            migrationBuilder.DropColumn(
                name: "Offer",
                table: "duels");

            migrationBuilder.DropColumn(
                name: "Ante",
                table: "duels");

            migrationBuilder.AddColumn<string>(
                name: "Sideboard",
                table: "duels",
                type: "text",
                nullable: false,
                defaultValue: "[]");

            migrationBuilder.AddColumn<int>(
                name: "Hearts",
                table: "players",
                type: "integer",
                nullable: false,
                defaultValue: 2);

            migrationBuilder.AddColumn<int>(
                name: "MaxHearts",
                table: "players",
                type: "integer",
                nullable: false,
                defaultValue: 2);

            migrationBuilder.AddColumn<int>(
                name: "Game",
                table: "duels",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<long>(
                name: "GearInstance",
                table: "duels",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Gift",
                table: "duels",
                type: "character varying(160)",
                maxLength: 160,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "MobLife",
                table: "duels",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "MobLifeEnd",
                table: "duels",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "Price",
                table: "duels",
                type: "bigint",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "sideboard",
                columns: table => new
                {
                    PlayerId = table.Column<string>(type: "text", nullable: false),
                    Name = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    Count = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_sideboard", x => new { x.PlayerId, x.Name });
                });

            migrationBuilder.CreateIndex(
                name: "IX_duels_PlayerId_Space_Spawn_Epoch_Game",
                table: "duels",
                columns: new[] { "PlayerId", "Space", "Spawn", "Epoch", "Game" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "sideboard");

            migrationBuilder.DropIndex(
                name: "IX_duels_PlayerId_Space_Spawn_Epoch_Game",
                table: "duels");

            migrationBuilder.DropColumn(
                name: "Hearts",
                table: "players");

            migrationBuilder.DropColumn(
                name: "MaxHearts",
                table: "players");

            migrationBuilder.DropColumn(
                name: "Game",
                table: "duels");

            migrationBuilder.DropColumn(
                name: "GearInstance",
                table: "duels");

            migrationBuilder.DropColumn(
                name: "Gift",
                table: "duels");

            migrationBuilder.DropColumn(
                name: "MobLife",
                table: "duels");

            migrationBuilder.DropColumn(
                name: "MobLifeEnd",
                table: "duels");

            migrationBuilder.DropColumn(
                name: "Price",
                table: "duels");

            migrationBuilder.DropColumn(
                name: "Sideboard",
                table: "duels");

            migrationBuilder.AddColumn<string>(
                name: "Ante",
                table: "duels",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<long>(
                name: "AnteValue",
                table: "duels",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<long>(
                name: "Cap",
                table: "duels",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<string>(
                name: "Offer",
                table: "duels",
                type: "text",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "ante",
                columns: table => new
                {
                    PlayerId = table.Column<string>(type: "text", nullable: false),
                    Name = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    Count = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ante", x => new { x.PlayerId, x.Name });
                });

            migrationBuilder.CreateIndex(
                name: "IX_duels_PlayerId_Space_Spawn_Epoch",
                table: "duels",
                columns: new[] { "PlayerId", "Space", "Spawn", "Epoch" },
                unique: true);
        }
    }
}
