import { existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { serverDll } from "../scripts/reports.mjs";
import { openRealm, realm } from "./realm";

// Playtest reports (F8; src/reports, realms/reports/README.md), offline: F8 in the world opens the report box with the
// screenshot it took, the world standing still behind it; Escape closes it; a report with no title is not sent; one sent
// is written by the dev server with the realm server's own writer as a folder - report.md with its front matter, the
// screenshot, context.json with the game's state, the console. REPORT_SHOTS=<dir> keeps a picture of the box.

/** Where the dev server writes offline reports in this suite (playwright.config.ts). */
const REPORTS = join(tmpdir(), "cantrip-realms-e2e-reports");

test.skip(!serverDll(), "the realm server is not built, and its writer files offline reports");

test("F8 files a playtest report with its screenshot, state and logs", async ({ page }) => {
  await openRealm(page, { at: "new-benalia", extra: "&mobs=0" });
  // A line of the page's console, which the report keeps (console.log).
  await page.evaluate(() => console.log("a line for the report's console log"));
  const box = page.locator("[data-test='report']");

  await page.keyboard.press("F8");
  await expect(box).toBeVisible();
  await expect(box.locator("img.report-shot")).toBeVisible();
  expect(await realm<string>(page, "game.screen")).toBe("report");
  await page.keyboard.press("Escape");
  await expect(box).toBeHidden();
  expect(await realm<string>(page, "game.screen")).toBe("world");

  await page.keyboard.press("F8");
  await expect(box).toBeVisible();
  // No title, nothing sent.
  await page.locator("[data-test='report:send']").click();
  await expect(page.locator("[data-test='report:problem']")).toHaveText("Give it a title.");

  // A word that would turn the camera (Q, E) or open the map (M) is the box's while it is open.
  const title = `The quiet fountain ${Date.now()}`;
  await page.locator("[data-test='report:kind:feedback']").click();
  await page.locator("[data-test='report:severity:major']").click();
  await page.locator("[data-test='report:area']").selectOption("visuals");
  await page.locator("[data-test='report:title']").fill(title);
  await page.locator("[data-test='report:description']").pressSequentially("Quiet: me, maybe? ");
  if (process.env.REPORT_SHOTS) await page.screenshot({ path: join(process.env.REPORT_SHOTS, "report-box.png") });
  await expect(page.locator(".world-map")).toBeHidden();
  await page.keyboard.press("Control+Enter");
  await expect(box).toBeHidden();
  await expect(page.locator("#hud-message")).toContainText("your report was sent");

  const slug = title.toLowerCase().replaceAll(" ", "-");
  const id = readdirSync(REPORTS).find((d) => d.endsWith(`-feedback-${slug}`));
  expect(id, `a folder for the report in ${REPORTS}`).toBeTruthy();
  const folder = join(REPORTS, id!);
  const md = readFileSync(join(folder, "report.md"), "utf8");
  expect(md).toContain("kind: feedback\nseverity: major\narea: visuals\nstatus: new\n");
  expect(md).toContain(`title: "${title}"`);
  expect(md).toContain('player: "offline-Tester"');
  expect(md).toContain("Quiet: me, maybe?");
  expect(md).toMatch(/- Place: world, tile \d+,\d+/);
  const png = readFileSync(join(folder, "screenshot.png"));
  expect([...png.subarray(1, 4)].map((b) => String.fromCharCode(b)).join("")).toBe("PNG");
  expect(png.length).toBeGreaterThan(5000);
  const context = JSON.parse(readFileSync(join(folder, "context.json"), "utf8")) as { Page: { game: { space: string }; character: { Name: string } } };
  expect(context.Page.game.space).toBe("world");
  expect(context.Page.character.Name).toBe("Tester");
  expect(existsSync(join(folder, "console.log"))).toBe(true);
});
