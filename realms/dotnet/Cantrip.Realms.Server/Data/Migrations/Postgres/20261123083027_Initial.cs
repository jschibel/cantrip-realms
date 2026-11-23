using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Cantrip.Realms.Server.Data.Migrations.Postgres
{
    /// <inheritdoc />
    public partial class Initial : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
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

            migrationBuilder.CreateTable(
                name: "chests",
                columns: table => new
                {
                    PlayerId = table.Column<string>(type: "text", nullable: false),
                    Map = table.Column<string>(type: "text", nullable: false),
                    Chest = table.Column<string>(type: "text", nullable: false),
                    OpenedAt = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_chests", x => new { x.PlayerId, x.Map, x.Chest });
                });

            migrationBuilder.CreateTable(
                name: "collection",
                columns: table => new
                {
                    PlayerId = table.Column<string>(type: "text", nullable: false),
                    Name = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    Count = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_collection", x => new { x.PlayerId, x.Name });
                });

            migrationBuilder.CreateTable(
                name: "deck",
                columns: table => new
                {
                    PlayerId = table.Column<string>(type: "text", nullable: false),
                    Name = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    Count = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_deck", x => new { x.PlayerId, x.Name });
                });

            migrationBuilder.CreateTable(
                name: "duels",
                columns: table => new
                {
                    Token = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    PlayerId = table.Column<string>(type: "text", nullable: false),
                    Map = table.Column<string>(type: "text", nullable: false),
                    Spawn = table.Column<string>(type: "text", nullable: false),
                    Epoch = table.Column<long>(type: "bigint", nullable: false),
                    Mob = table.Column<string>(type: "text", nullable: false),
                    Seed = table.Column<long>(type: "bigint", nullable: false),
                    StartedAt = table.Column<long>(type: "bigint", nullable: false),
                    State = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Spec = table.Column<string>(type: "text", nullable: false),
                    Ante = table.Column<string>(type: "text", nullable: false),
                    AnteValue = table.Column<long>(type: "bigint", nullable: false),
                    Cap = table.Column<long>(type: "bigint", nullable: false),
                    FinishedAt = table.Column<long>(type: "bigint", nullable: true),
                    Gold = table.Column<long>(type: "bigint", nullable: false),
                    Offer = table.Column<string>(type: "text", nullable: true),
                    Detail = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_duels", x => x.Token);
                });

            migrationBuilder.CreateTable(
                name: "gear_owned",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    PlayerId = table.Column<string>(type: "text", nullable: false),
                    GearId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    AcquiredAt = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_gear_owned", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "loadout",
                columns: table => new
                {
                    PlayerId = table.Column<string>(type: "text", nullable: false),
                    Slot = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    GearInstanceId = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_loadout", x => new { x.PlayerId, x.Slot });
                });

            migrationBuilder.CreateTable(
                name: "players",
                columns: table => new
                {
                    Id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Name = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Body = table.Column<int>(type: "integer", nullable: false),
                    Palette = table.Column<int>(type: "integer", nullable: false),
                    Color = table.Column<string>(type: "character varying(1)", maxLength: 1, nullable: false),
                    Gold = table.Column<long>(type: "bigint", nullable: false),
                    Map = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Q = table.Column<int>(type: "integer", nullable: false),
                    R = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_players", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "quests",
                columns: table => new
                {
                    PlayerId = table.Column<string>(type: "text", nullable: false),
                    Quest = table.Column<string>(type: "text", nullable: false),
                    Progress = table.Column<int>(type: "integer", nullable: false),
                    CompletedAt = table.Column<long>(type: "bigint", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_quests", x => new { x.PlayerId, x.Quest });
                });

            migrationBuilder.CreateTable(
                name: "unlocks",
                columns: table => new
                {
                    PlayerId = table.Column<string>(type: "text", nullable: false),
                    Color = table.Column<string>(type: "character varying(1)", maxLength: 1, nullable: false),
                    At = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_unlocks", x => new { x.PlayerId, x.Color });
                });

            migrationBuilder.CreateTable(
                name: "vendor_stock",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    VendorId = table.Column<string>(type: "text", nullable: false),
                    Name = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    Count = table.Column<int>(type: "integer", nullable: false),
                    Source = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Until = table.Column<long>(type: "bigint", nullable: true),
                    AddedAt = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_vendor_stock", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "vendor_visits",
                columns: table => new
                {
                    VendorId = table.Column<string>(type: "text", nullable: false),
                    PlayerId = table.Column<string>(type: "text", nullable: false),
                    Hour = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_vendor_visits", x => new { x.VendorId, x.PlayerId, x.Hour });
                });

            migrationBuilder.CreateTable(
                name: "vendors",
                columns: table => new
                {
                    Id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Purse = table.Column<long>(type: "bigint", nullable: false),
                    Hour = table.Column<long>(type: "bigint", nullable: false),
                    CreatedAt = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_vendors", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_duels_PlayerId_Map_Spawn_Epoch",
                table: "duels",
                columns: new[] { "PlayerId", "Map", "Spawn", "Epoch" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_duels_PlayerId_State",
                table: "duels",
                columns: new[] { "PlayerId", "State" });

            migrationBuilder.CreateIndex(
                name: "IX_gear_owned_PlayerId",
                table: "gear_owned",
                column: "PlayerId");

            migrationBuilder.CreateIndex(
                name: "IX_loadout_GearInstanceId",
                table: "loadout",
                column: "GearInstanceId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_vendor_stock_VendorId_Name",
                table: "vendor_stock",
                columns: new[] { "VendorId", "Name" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ante");

            migrationBuilder.DropTable(
                name: "chests");

            migrationBuilder.DropTable(
                name: "collection");

            migrationBuilder.DropTable(
                name: "deck");

            migrationBuilder.DropTable(
                name: "duels");

            migrationBuilder.DropTable(
                name: "gear_owned");

            migrationBuilder.DropTable(
                name: "loadout");

            migrationBuilder.DropTable(
                name: "players");

            migrationBuilder.DropTable(
                name: "quests");

            migrationBuilder.DropTable(
                name: "unlocks");

            migrationBuilder.DropTable(
                name: "vendor_stock");

            migrationBuilder.DropTable(
                name: "vendor_visits");

            migrationBuilder.DropTable(
                name: "vendors");
        }
    }
}
