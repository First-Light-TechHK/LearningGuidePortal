import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.BASE_URL || "http://127.0.0.1:3011";
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1540 } });
  const api = context.request;
  const config = await (await api.get(`${base}/api/health/config`)).json();
  assert.equal(config.environment, "DEV");
  assert.equal(config.payment.mode, "demo");
  const registered = await api.post(`${base}/api/auth/register`, { data: { email: `overview.${Date.now()}@example.test`, password: "TestPass123!", nickname: "Design Test" } });
  assert.equal(registered.status(), 200);
  const page = await context.newPage();
  await page.goto(`${base}/en-GB/account/my-learning`);
  await page.getByRole("button", { name: "Use essential cookies only" }).click();
  assert.equal(await page.locator(".overview-course").count(), 0);
  assert.ok(await page.locator(".account-empty-state a").isVisible());
  const { quote } = await (await api.post(`${base}/api/purchase/quote`, { data: { planId: "epicureanism-pc-6" } })).json();
  const { order } = await (await api.post(`${base}/api/purchase/checkout`, { data: { quoteId: quote.id, consents: { renewal: true, terms: true, refund: true } } })).json();
  assert.equal((await api.post(`${base}/api/purchase/demo/confirm`, { data: { orderId: order.id, action: "complete" } })).status(), 200);
  assert.equal((await api.post(`${base}/api/study/events`, { data: { courseId: "epicureanism", lessonId: "pleasure-and-the-good-life", event: "complete", seconds: 1500, clientEventId: `overview-${Date.now()}` } })).status(), 200);
  await page.reload();
  await page.evaluate(() => document.fonts.ready);
  await page.locator(".overview-course img").evaluateAll(async (images) => {
    await Promise.all(images.map((image) => image.decode()));
  });
  const heading = await page.locator("#my-learning-heading").boundingBox();
  const card = await page.locator(".overview-course").first().boundingBox();
  const title = await page.locator(".overview-course h3").first().boundingBox();
  assert.equal(heading.x, 344);
  assert.equal(heading.y, 118);
  assert.equal(card.x, 344);
  assert.equal(card.y, 294);
  assert.equal(card.width, 946);
  assert.equal(card.height, 178);
  assert.equal(title.x, 570);
  assert.equal(title.y, 322);
  const progress = await page.locator(".overview-course-progress").first().boundingBox();
  assert.equal(progress.x, 570);
  assert.ok(Math.abs(progress.y - 412) < 0.1, "Progress track must match the design within browser subpixel rounding");
  const action = await page.locator(".account-learning-action").first().boundingBox();
  assert.equal(action.x, 1065);
  assert.equal(action.y, 358);
  await page.screenshot({ path: "/tmp/lg-overview-actual.png", fullPage: true });
  for (const locale of ["en-GB", "zh-CN"]) {
    await page.goto(`${base}/${locale}/account/my-learning`);
    for (const width of [768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${locale}: overflow at ${width}`);
      assert.ok(await page.locator(".account-learning-action").isVisible());
    }
  }
  console.log(JSON.stringify({ passed: true, figmaNode: "131:472", heading, card, title }));
} finally { await browser.close(); }
