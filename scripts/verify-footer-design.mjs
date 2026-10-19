import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.BASE_URL || "http://127.0.0.1:3011";
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1471 } });
  await page.goto(`${base}/en-GB/pricing`);
  await page.getByRole("button", { name: "Use essential cookies only" }).click();
  await page.evaluate(() => document.fonts.ready);
  const measured = await page.locator(".portal-footer").evaluate((footer) => {
    const top = footer.getBoundingClientRect().top;
    const rect = (element) => { const box = element.getBoundingClientRect(); return { x: box.x, y: box.y - top, width: box.width, height: box.height }; };
    return {
      height: footer.getBoundingClientRect().height,
      background: getComputedStyle(footer).backgroundColor,
      headings: [...footer.querySelectorAll("h2")].map(rect),
      copyright: rect(footer.querySelector(".portal-footer-copyright")),
      divider: rect(footer.querySelector(".portal-footer-bottom")),
      social: rect(footer.querySelector(".portal-footer-social"))
    };
  });
  assert.deepEqual(measured.headings.map((item) => item.x), [100, 560, 795, 1030]);
  assert.deepEqual(measured.headings.map((item) => item.y), [54, 54, 54, 54]);
  assert.equal(measured.copyright.x, 1030);
  assert.equal(measured.copyright.y, 150);
  assert.equal(measured.divider.y, 216);
  assert.equal(measured.social.y, 238);
  assert.equal(measured.height, 306);
  assert.equal(measured.background, "rgb(18, 51, 125)");
  await page.locator(".portal-footer").screenshot({ path: "/tmp/lg-footer-measured.png" });
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `Overflow at ${width}`);
  }
  console.log(JSON.stringify({ passed: true, figmaNode: "131:955", measured }));
} finally { await browser.close(); }
