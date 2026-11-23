// Takes pictures of the art gallery's boards (gallery.html) for review: node scripts/gallery-shots.mjs <out dir> <port>
// [board[:heading[:zoom]] ...]. The dev server must be running on the port (npx vite --port <port>).
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const [out, port, ...asked] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
let list = asked;
if (list.length === 0 || list[0] === "all") {
  await page.goto(`http://localhost:${port}/gallery.html?test&manual`);
  await page.waitForFunction(() => globalThis.galleryTest?.ready === true, undefined, { timeout: 60000 });
  list = await page.evaluate(() => globalThis.galleryTest.boards);
}
for (const item of list) {
  const [board, heading = "front", zoom = "0"] = item.split(":");
  await page.goto(`http://localhost:${port}/gallery.html?test&manual&board=${board}&heading=${heading}&zoom=${zoom}`);
  await page.waitForFunction(() => globalThis.galleryTest?.ready === true, undefined, { timeout: 60000 });
  await page.evaluate(() => globalThis.galleryTest.advance(0.5));
  const file = join(out, `${board}-${heading}-z${zoom}.png`);
  await page.screenshot({ path: file });
  console.log(file);
}
if (errors.length) console.log("ERRORS:\n" + errors.join("\n"));
await browser.close();
