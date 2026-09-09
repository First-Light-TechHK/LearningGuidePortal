import assert from "node:assert/strict";
import { chromium, firefox, webkit } from "playwright";

const base = process.env.BASE_URL || "http://127.0.0.1:3011";
for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await engine.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${base}/en-GB/portal/courses?category=European%20Humanities`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Use essential cookies only" }).click();
    assert.equal(await page.locator(".portal-category-filter [aria-current]").innerText(), "European Humanities");
    const grid = await page.locator(".portal-course-grid").boundingBox();
    assert.equal(grid.x, 100); assert.equal(grid.width, 1240);
    const card = await page.locator(".portal-course-card").first().boundingBox();
    assert.equal(card.width, 400);
    assert.ok((await page.locator(".portal-course-category").allTextContents()).every(text => text === "European Humanities"));
    await page.locator(".portal-language").click();
    await page.waitForURL(url => url.pathname === "/zh-CN/portal/courses" && url.searchParams.get("category") === "European Humanities");
    assert.equal(await page.locator(".portal-category-filter [aria-current]").innerText(), "欧洲人文");
    for (const width of [768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name} overflow at ${width}`);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: `/tmp/lg-catalogue-${name}.png`, fullPage: true });
    for (let index = 0; index < 3; index++) {
      await page.goto(`${base}/en-GB/portal`);
      await page.goto(`${base}/en-GB/pricing`);
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ browser: name, passed: true, categoryAndLocalePreserved: true, rapidNavigation: true }));
  } finally { await browser.close(); }
}
