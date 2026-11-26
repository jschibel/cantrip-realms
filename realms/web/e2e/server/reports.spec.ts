import { readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { spawnNear } from "../places";
import { entity, openNear, realm, until, waitReady } from "../realm";
import { CARDS, cardState, clickCardControl } from "./cardLayer";
import { SERVER, signIn } from "./server";

// A playtest report from inside a duel (F8; src/reports, realms/reports/README.md), against the real server with the
// real card layer: the duel's page has the keys, so it passes F8 up (Realm.js) and the overworld's report box opens over
// the duel; the picture is the world's with the card layer's own over it, and its console goes with it. The server
// writes the report where REALMS_REPORTS says (playwright.config.ts), with the character as it stores them.

const REPORTS = join(tmpdir(), "cantrip-realms-e2e-server-reports");

const query = `/?server=${encodeURIComponent(SERVER)}&cards=${encodeURIComponent(`${CARDS}?test`)}&test&wander=0&encounters=never`;

test("F8 in a duel files a report with the card layer's picture and console", async ({ page }) => {
  test.setTimeout(360_000);
  await signIn(page.request, 31, "Rhea");
  const made = await page.request.post(new URL("api/character", SERVER).toString(), { data: { Name: "Rhea", Body: "lithe", Palette: 1, Color: "W" } });
  expect(made.ok(), await made.text()).toBe(true);
  const spawn = spawnNear("new-benalia");
  const start = openNear(spawn, 6);
  const placed = await page.request.post(new URL("dev/place", SERVER).toString(), { data: { Space: "world", X: start.x, Z: start.z } });
  expect(placed.ok(), await placed.text()).toBe(true);
  await page.goto(query);
  await waitReady(page);
  await expect.poll(() => realm<boolean>(page, "layer.ready"), { timeout: 180_000 }).toBe(true);

  const mob = await entity(page, (e) => e.kind === "mob" && e.spawn === spawn.id, "the spawn's mob");
  await page.mouse.click(mob.x, mob.y);
  await until(page, async () => (await realm<string | null>(page, "layer.open")) === "duel", "the duel", 60);
  await clickCardControl(page, "Fight");
  await expect
    .poll(async () => {
      const state = await cardState(page);
      return state?.ready === true && state.prompt.length > 0;
    }, { timeout: 120_000, message: "the duel dealt in the card layer" })
    .toBe(true);

  // The card layer's page has the keys: F8 there opens the overworld's box over the duel.
  await page.frameLocator("iframe.card-layer").locator("body").press("F8");
  const box = page.locator("[data-test='report']");
  await expect(box).toBeVisible();
  await expect(box.locator("img.report-shot")).toBeVisible();
  const title = `A duel report ${Date.now()}`;
  await page.locator("[data-test='report:title']").fill(title);
  await page.locator("[data-test='report:description']").fill("The mob's hand looked odd.");
  const filed = page.waitForResponse((r) => r.url().endsWith("/api/reports"));
  await page.locator("[data-test='report:send']").click();
  const response = await filed;
  expect(response.ok(), await response.text()).toBe(true);
  const { Id } = (await response.json()) as { Id: string };
  await expect(box).toBeHidden();
  // The duel is still there, its page given the keys back.
  expect(await realm<string | null>(page, "layer.open")).toBe("duel");

  expect(readdirSync(REPORTS)).toContain(Id);
  const folder = join(REPORTS, Id);
  const md = readFileSync(join(folder, "report.md"), "utf8");
  expect(md).toContain("kind: bug\nseverity: minor\narea: duels\nstatus: new\n");
  expect(md).toContain('player: "dev-31"\ncharacter: "Rhea"\n');
  expect(md).toContain('screen: "duel"');
  const context = JSON.parse(readFileSync(join(folder, "context.json"), "utf8")) as { Page: { cards: { open: string; pictured: boolean; requests: { screen: string }[] } }; Server: { State: { Duels: unknown[] } } };
  expect(context.Page.cards.open).toBe("duel");
  // The duel itself is in the picture: the card layer read its own canvas (Realm.js).
  expect(context.Page.cards.pictured).toBe(true);
  expect(context.Page.cards.requests.some((r) => r.screen === "duel")).toBe(true);
  expect(context.Server.State.Duels.length).toBeGreaterThan(0);
  const png = readFileSync(join(folder, "screenshot.png"));
  expect(png.length).toBeGreaterThan(5000);
  // What the card layer said lately came with it.
  expect(readdirSync(folder)).toContain("network.log");
});
