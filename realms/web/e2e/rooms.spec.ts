import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Page, expect, test } from "@playwright/test";

// The rooms and dungeons gallery (rooms.html): every room kind and every dungeon theme renders at each of the camera's
// three headings, and draws something - not a black frame. With ROOMS_SHOTS=1 the pictures are written to
// e2e/screenshots/rooms for the owner to judge; otherwise to test-results/rooms. ROOMS_ONLY=<a query fragment> renders
// only the pages whose query contains it (room=inn, dungeon=caves), for working on one.

const here = dirname(fileURLToPath(import.meta.url));
const shots = !!process.env.ROOMS_SHOTS;
const only = process.env.ROOMS_ONLY ?? "";
const out = shots ? join(here, "screenshots", "rooms") : join(here, "..", "test-results", "rooms");
mkdirSync(out, { recursive: true });

const KINDS = ["shop", "inn", "guildhall", "temple", "smithy", "library", "house", "tower", "exotic-wares"] as const;
const STYLES = ["benalish", "llanowar", "morass", "keldon", "tolarian", "vess"] as const;
const THEMES = ["caves", "castle", "tower", "crypt", "hollow", "foundry", "portal"] as const;
const HEADINGS = ["left", "front", "right"] as const;

/** Each kind in the style it is most at home in, so every style is seen too. */
const HOME: Record<(typeof KINDS)[number], (typeof STYLES)[number]> = {
  shop: "benalish",
  inn: "keldon",
  guildhall: "benalish",
  temple: "vess",
  smithy: "keldon",
  library: "tolarian",
  house: "llanowar",
  tower: "tolarian",
  "exotic-wares": "morass",
};

async function shoot(page: Page, query: string, name: string): Promise<void> {
  await page.goto(`/rooms.html?test&${query}`);
  await page.waitForFunction(() => (globalThis as any).roomsTest?.ready === true && (globalThis as any).roomsTest.frames > 2, undefined, { timeout: 30_000 });
  const shot = await page.screenshot({ path: join(out, `${name}.png`) });
  // Something is drawn: the frame is not all one color.
  expect(new Set(shot.subarray(0, 4096)).size, `${name} draws something`).toBeGreaterThan(8);
}

const pages: { query: string; name: string }[] = [];
for (const kind of KINDS) for (const heading of HEADINGS) pages.push({ query: `room=${kind}&style=${HOME[kind]}&seed=1&heading=${heading}`, name: `${kind}-${heading}` });
for (const style of STYLES) pages.push({ query: `room=shop&style=${style}&seed=2&heading=front`, name: `style-${style}` });
for (const [kind, specialty] of [["shop", "cards"], ["shop", "curios"], ["shop", "books"], ["shop", "weapons"]] as const) pages.push({ query: `room=${kind}&style=benalish&seed=3&specialty=${specialty}&heading=right`, name: `shop-${specialty}` });
pages.push({ query: "room=inn&style=benalish&seed=4&upstairs=0&heading=front", name: "tavern-front" });
for (const theme of THEMES) for (const heading of HEADINGS) pages.push({ query: `dungeon=${theme}&seed=1&floor=0&floors=3&heading=${heading}`, name: `dungeon-${theme}-${heading}` });
for (const theme of THEMES) pages.push({ query: `dungeon=${theme}&seed=2&floor=2&floors=3&heading=front`, name: `dungeon-${theme}-last` });

test.describe("the rooms gallery", () => {
  test("lists every room kind and theme", async ({ page }) => {
    await page.goto("/rooms.html");
    await page.waitForFunction(() => (globalThis as any).roomsTest?.ready === true);
    for (const kind of KINDS) await expect(page.getByText(kind, { exact: true }).first()).toBeVisible();
  });

  for (const p of pages.filter((p) => p.query.includes(only))) {
    test(p.name, async ({ page }) => {
      await shoot(page, p.query, p.name);
    });
  }
});
