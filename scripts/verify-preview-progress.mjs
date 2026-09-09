import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.BASE_URL || "http://127.0.0.1:3011";
const browser = await chromium.launch();
try {
  const context = await browser.newContext();
  const api = context.request;
  const config = await (await api.get(`${base}/api/health/config`)).json();
  assert.equal(config.environment, "DEV"); assert.equal(config.payment.mode, "demo");
  assert.equal((await api.post(`${base}/api/study/preview`, { data: { courseId: "epicureanism", lessonId: "pleasure-and-the-good-life", event: "open" } })).status(), 401);
  assert.equal((await api.post(`${base}/api/auth/register`, { data: { email: `preview.${Date.now()}@example.test`, password: "TestPass123!", nickname: "Preview Test" } })).status(), 200);
  const page = await context.newPage();
  await page.goto(`${base}/en-GB/portal/courses/epicureanism/public-lesson`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Use essential cookies only" }).click();
  await page.goto(`${base}/en-GB/account/my-learning`, { waitUntil: "networkidle" });
  assert.equal(await page.locator(".overview-course").count(), 1);
  assert.equal(await page.locator(".account-learning-action").innerText(), "Continue preview");
  const before = await (await api.post(`${base}/api/study/preview`, { data: { courseId: "epicureanism", lessonId: "pleasure-and-the-good-life", event: "open" } })).json();
  await page.locator(".account-learning-action").click();
  await page.locator(".preview-progress button").click();
  await page.waitForFunction(() => document.querySelector(".preview-progress button")?.textContent === "Completed");
  const complete = await (await api.post(`${base}/api/study/preview`, { data: { courseId: "epicureanism", lessonId: "pleasure-and-the-good-life", event: "complete", seconds: 1500 } })).json();
  assert.equal(complete.record.id, before.record.id);
  assert.equal(complete.record.totalSeconds, 1500, "A duplicate completion must not add time twice");
  assert.equal((await api.post(`${base}/api/study/events`, { data: { courseId: "epicureanism", lessonId: "pleasure-and-the-good-life", event: "open", clientEventId: "not-paid" } })).status(), 400, "Preview must not grant paid access");
  assert.equal((await api.post(`${base}/api/study/preview`, { data: { courseId: "epicureanism", lessonId: "not-a-public-lesson", event: "complete", seconds: 1500 } })).status(), 400);
  assert.equal((await page.goto(`${base}/en-GB/portal/courses/epicureanism/public-lesson?lessonId=not-a-public-lesson`)).status(), 404);
  await page.goto(`${base}/en-GB/account/my-learning`);
  assert.equal(await page.locator(".account-learning-action").innerText(), "View plans");
  const { quote } = await (await api.post(`${base}/api/purchase/quote`, { data: { planId: "epicureanism-pc-6" } })).json();
  const { order } = await (await api.post(`${base}/api/purchase/checkout`, { data: { quoteId: quote.id, consents: { renewal: true, terms: true, refund: true } } })).json();
  assert.equal((await api.post(`${base}/api/purchase/demo/confirm`, { data: { orderId: order.id, action: "complete" } })).status(), 200);
  const paid = await (await api.post(`${base}/api/study/events`, { data: { courseId: "epicureanism", lessonId: "pleasure-and-the-good-life", event: "complete", seconds: 1500, clientEventId: "paid-repeat" } })).json();
  assert.equal(paid.record.id, before.record.id);
  assert.equal(paid.record.totalSeconds, complete.record.totalSeconds);
  for (const locale of ["en-GB", "zh-CN"]) {
    await page.goto(`${base}/${locale}/account/my-learning`, { waitUntil: "networkidle" });
    assert.equal(await page.locator(".overview-course").count(), 1);
    assert.equal(await page.locator(".account-learning-action").getAttribute("href"), `/${locale}/account/learn/epicureanism`);
  }
  console.log("PASS: preview history, range enforcement, paid-access isolation, idempotent completion, preserved progress after purchase, bilingual continuation.");
} finally { await browser.close(); }
