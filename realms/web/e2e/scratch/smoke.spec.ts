import { test } from "@playwright/test";
import { openRealm, realm } from "../realm";
test("smoke", async ({ page }) => {
  page.on("console", (m) => { if (m.type() === "error") console.log("console:", m.text()); });
  page.on("pageerror", (e) => console.log("pageerror:", e.message));
  await openRealm(page, { at: "new-benalia" });
  await page.waitForTimeout(1500);
  console.log(JSON.stringify(await realm(page, "space")), JSON.stringify(await realm(page, "area")), JSON.stringify(await realm(page, "chunks")));
  await page.screenshot({ path: process.env.SHOT ?? "smoke.png" });
});
