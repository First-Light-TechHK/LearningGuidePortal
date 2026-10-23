import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { orderReceiptHtml } from "../../lib/orderReceiptHtml";
import { getMessages } from "../../lib/i18n/messages";

test("receipt shows only paid details in both locales, escapes data and fits mobile", async () => {
  const browser = await chromium.launch();
  await mkdir("test-results/order-receipt", { recursive: true });
  try {
    for (const locale of ["en-GB", "zh-CN"] as const) {
      const copy = getMessages(locale).orderReceipt;
      const page = await browser.newPage();
      const receipt = { orderId: '<script>alert("x")</script>', planName: "Everything & Science", amountMinor: 3950, currency: "usd", paidAt: "2026-10-21T12:30:00.000Z", paymentMode: "stripe" as const };
      await page.setContent(orderReceiptHtml(receipt, locale));
      assert.equal(await page.locator("html").getAttribute("lang"), locale);
      assert.equal(await page.locator("h1").textContent(), copy.title);
      assert.deepEqual(await page.locator("dt").allTextContents(), [copy.plan, copy.order, copy.date, copy.amount, copy.payment]);
      const values = await page.locator("dd").allTextContents();
      assert.equal(values[0], receipt.planName); assert.equal(values[1], receipt.orderId);
      assert.equal(values[3], "US$39.50"); assert.equal(values[4], copy.stripe);
      assert.equal(await page.locator("script").count(), 0);
      assert.doesNotMatch(await page.locator("body").textContent() || "", /remaining|balance|余额|剩余|USD/i);
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.screenshot({ path: `test-results/order-receipt/${locale}-${width}.png`, fullPage: true });
      }
      await page.setContent(orderReceiptHtml({ ...receipt, paidAt: null, paymentMode: "demo" }, locale));
      assert.equal(await page.locator("dd").nth(2).textContent(), copy.unavailableDate);
      assert.equal(await page.locator("dd").last().textContent(), copy.demo);
      await page.close();
    }
  } finally { await browser.close(); }
});
