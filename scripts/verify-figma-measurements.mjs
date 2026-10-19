import { chromium, firefox, webkit } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

// Measurements from the supplied .fig exports, not screenshots of our application.
// This checks selected properties; it does not claim full-image pixel equivalence.
const base = process.env.BASE_URL || "http://127.0.0.1:3013";
const out = process.env.OUT_DIR || "/tmp/lg-figma-measurements";
const checks = [
  ["2007:179", ".portal-header", { x: 0, y: 0, width: 1440, height: 68 }],
  ["2007:158", ".portal-brand-mark img", { x: 40, width: 24, height: 24 }],
  ["2007:163", ".portal-brand > span:last-child", { x: 72, fontSize: "20px", fontWeight: "600", color: "rgb(10, 10, 10)" }],
  ["2007:164", ".portal-nav", { x: 252.0390625, columnGap: "30px" }],
  ["2007:165", ".portal-nav a:first-child", { fontSize: "14px", fontWeight: "500" }],
  ["2007:173", ".portal-language", { x: 1103, y: 23, width: 42, height: 22, borderRadius: "4px", backgroundColor: "rgb(217, 217, 217)" }],
  ["2007:174", ".portal-language", { fontSize: "14px", fontWeight: "500" }],
  ["2007:168", ".portal-header-link", { x: 1198.7109375, y: 16, width: 76.953125, height: 36 }],
  ["2007:170", ".portal-header-cta", { x: 1291.6640625, y: 16, width: 108.3359375, height: 36, borderRadius: "10px", backgroundColor: "rgb(21, 93, 252)", fontWeight: "500" }],
  ["121:8143", ".auth-credential-form", { x: 448.5, y: 311, width: 448, height: 464, borderRadius: "14px" }],
  ["121:8147", ".auth-fields > label:first-child", { fontSize: "14px", fontWeight: "500", color: "rgb(54, 65, 83)" }],
  ["121:8149", ".auth-input input[type=email]", { x: 480.5, y: 371, width: 384, height: 50, borderRadius: "10px", borderTopColor: "rgb(209, 213, 220)" }],
  ["121:8159", ".auth-input input[autocomplete=current-password]", { x: 480.5, y: 469, width: 384, height: 50, borderRadius: "10px" }],
  ["121:8169", ".auth-options", { x: 480.5, y: 543, width: 384, height: 20 }],
  ["121:8176", ".auth-submit", { x: 480.5, y: 587, width: 384, height: 46, borderRadius: "10px", fontWeight: "500", backgroundColor: "rgb(21, 93, 252)" }],
  ["121:8184", ".auth-provider-links", { y: 701, height: 32 }],
];
await mkdir(out, { recursive: true });
const results = [];
for (const [browserName, engine] of Object.entries({ chromium, firefox, webkit })) {
  if (process.env.BROWSER && process.env.BROWSER !== browserName) continue;
  const browser = await engine.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1024 } });
    await page.goto(`${base}/en-GB/portal/sign-in?step=password`);
    await page.evaluate(() => document.fonts.ready);
    for (const [node, selector, expected] of checks) {
      const actual = await page.locator(selector).evaluate(element => {
        const r = element.getBoundingClientRect();
        const s = getComputedStyle(element);
        return Object.assign({ x: r.x, y: r.y, width: r.width, height: r.height },
          Object.fromEntries(["fontSize", "fontWeight", "color", "borderRadius", "backgroundColor", "borderTopColor", "columnGap"].map(key => [key, s[key]])));
      });
      for (const [property, value] of Object.entries(expected)) {
        const delta = typeof value === "number" ? actual[property] - value : null;
        results.push({ browser: browserName, node, selector, property, expected: value, actual: actual[property], delta,
          passed: delta === null ? actual[property] === value : Math.abs(delta) <= 0.55 });
      }
    }
    await page.screenshot({ path: path.join(out, `${browserName}-sign-in.png`), fullPage: true });
    if (process.env.MEASURE_ONLY === "1") continue;
    for (const locale of ["en-GB", "zh-CN"]) {
      for (const route of ["portal/sign-in", "portal/sign-in?step=password", "portal/sign-in?oauthError=state", "portal/sign-up", "portal", "portal/courses", "pricing"]) {
        await page.goto(`${base}/${locale}/${route}`);
        await page.evaluate(() => document.fonts.ready);
        for (const width of [1440, 768, 390, 320]) {
          await page.setViewportSize({ width, height: 1024 });
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
          results.push({ browser: browserName, locale, route, width, property: "horizontalOverflow", actual: overflow, passed: overflow <= 1 });
        }
      }
    }
  } finally { await browser.close(); }
}
await writeFile(path.join(out, "results.json"), JSON.stringify({ base, measuredAt: new Date().toISOString(), checks: results }, null, 2));
const failures = results.filter(result => !result.passed);
console.log(JSON.stringify({ total: results.length, passed: results.length - failures.length, failures }, null, 2));
if (failures.length) process.exitCode = 1;
