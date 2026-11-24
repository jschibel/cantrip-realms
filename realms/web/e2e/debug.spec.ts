import { expect, test } from "@playwright/test";
import { advance, openNear, openRealm, playerTile } from "./realm";

// The debug overlay (F3): it shows the player's place and tile, toggles with F3, and lists a jump - a move in one
// frame no walk could make - with the tiles it went from and to, and not a deliberate one (a new figure stood in the
// place, as a waystone does).

test("the debug overlay shows where the player is and lists a jump", async ({ page }) => {
  await openRealm(page, { at: "new-benalia", extra: "&debug&mobs=0" });
  const overlay = page.locator("#debug-overlay");
  await expect(overlay).toBeVisible();
  const me = await playerTile(page);
  await expect(overlay).toContainText("place   world");
  await expect(overlay).toContainText(`tile ${me.x},${me.z}`);
  await expect(overlay).toContainText("jumps   none seen");

  const to = openNear(me, 4);
  await page.evaluate(([x, z]) => (globalThis as any).realmTest.placePlayer(x, z), [to.x, to.z]);
  await advance(page, 0.1);
  await expect(overlay).toContainText("jumps (newest first):");
  await expect(overlay).toContainText(`(tile ${me.x},${me.z}) -> `);
  await expect(overlay).toContainText(`(tile ${to.x},${to.z})`);

  // A deliberate jump (a waystone's, a lost duel's: a new figure stood in the place behind the iris) is none.
  const far = openNear(me, 12);
  await page.evaluate(([x, z]) => {
    const stage = (globalThis as any).sliceStage;
    stage.arrive({ spot: stage.current, tile: { x, z }, facing: [0, 1] }, false);
  }, [far.x, far.z]);
  await advance(page, 0.1);
  await expect(overlay).not.toContainText(`(tile ${far.x},${far.z})`);

  await page.keyboard.press("F3");
  await expect(overlay).toBeHidden();
  await page.keyboard.press("F3");
  await expect(overlay).toBeVisible();
});
