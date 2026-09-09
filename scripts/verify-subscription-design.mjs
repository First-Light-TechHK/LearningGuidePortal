import assert from "node:assert/strict";
import { chromium, firefox, webkit } from "playwright";

const base = process.env.BASE_URL || "http://127.0.0.1:3011";
for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await engine.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
    const api = context.request;
    const config = await (await api.get(`${base}/api/health/config`)).json();
    assert.equal(config.environment, "DEV");
    assert.equal(config.payment.mode, "demo");
    assert.equal((await api.post(`${base}/api/auth/register`, { data: {
      email: `records.${name}.${Date.now()}@example.test`, password: "TestPass123!", nickname: "Records Test",
    } })).status(), 200);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${base}/en-GB/account/my-learning/subscription`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Use essential cookies only" }).click();
    assert.equal(await page.locator(".subscription-record").count(), 0);
    assert.ok(await page.locator(".subscription-record-empty a").isVisible());

    const orders = [];
    for (let index = 0; index < 2; index++) {
      const { quote } = await (await api.post(`${base}/api/purchase/quote`, { data: { planId: "epicureanism-pc-6" } })).json();
      assert.ok(quote?.id);
      const { order } = await (await api.post(`${base}/api/purchase/checkout`, { data: { quoteId: quote.id, consents: { renewal: true, terms: true, refund: true } } })).json();
      assert.ok(order?.id);
      assert.equal((await api.post(`${base}/api/purchase/demo/confirm`, { data: { orderId: order.id, action: "complete" } })).status(), 200);
      orders.unshift(order);
    }

    for (const locale of ["en-GB", "zh-CN"]) {
      await page.setViewportSize({ width: 1440, height: 1200 });
      await page.goto(`${base}/${locale}/account/my-learning/subscription`, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      const rows = page.locator(".subscription-record");
      assert.equal(await rows.count(), 2, "Every paid order must have its own record");
      assert.equal(await rows.locator(".table-actions button").count(), 1, "Only the latest payment has subscription actions");
      for (let index = 0; index < orders.length; index++) {
        const row = rows.nth(index);
        const order = orders[index];
        assert.match(await row.locator(".subscription-record-period").innerText(), /\d{4}/);
        assert.doesNotMatch(await row.innerText(), /Period not recorded/);
        const receipt = row.locator(".subscription-record-receipt");
        assert.equal(await receipt.getAttribute("href"), `/api/my-learning/orders/${order.id}/receipt`);
        assert.equal((await api.get(`${base}/api/my-learning/orders/${order.id}/receipt`)).status(), 200);
        assert.ok((await row.locator(".subscription-record-amount").innerText()).includes(new Intl.NumberFormat(locale, { style: "currency", currency: order.currency, currencyDisplay: "narrowSymbol" }).format(order.amountMinor / 100)));
      }
      const bounds = await rows.first().boundingBox();
      assert.ok(Math.abs(bounds.x - 344) < 0.1);
      assert.ok(Math.abs(bounds.y - 358) < 0.1, `First record starts at ${bounds.y}, expected 358`);
      assert.equal(bounds.width, 946);
      assert.equal(bounds.height, 132);
      await page.screenshot({ path: `/tmp/lg-subscription-${name}-${locale}.png`, fullPage: true });
      for (const width of [768, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}/${locale}: overflow at ${width}`);
      }
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ browser: name, passed: true, paymentRecords: 2, locales: 2 }));
    await context.close();
  } finally { await browser.close(); }
}
