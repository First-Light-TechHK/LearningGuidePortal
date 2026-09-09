import assert from "node:assert/strict";
import { chromium, firefox, webkit } from "playwright";

const base = process.env.BASE_URL || "http://127.0.0.1:3011";
for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await engine.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1206 } });
    const api = context.request;
    const config = await (await api.get(`${base}/api/health/config`)).json();
    assert.equal(config.environment, "DEV"); assert.equal(config.payment.mode, "demo");
    assert.equal((await api.post(`${base}/api/auth/register`, { data: { email: `upgrade.${name}.${Date.now()}@example.test`, password: "TestPass123!", nickname: "Upgrade Test" } })).status(), 200);
    const { quote: purchase } = await (await api.post(`${base}/api/purchase/quote`, { data: { planId: "european-humanities-pc-6" } })).json();
    const consents = { renewal: true, terms: true, refund: true };
    const { order } = await (await api.post(`${base}/api/purchase/checkout`, { data: { quoteId: purchase.id, consents } })).json();
    assert.equal((await api.post(`${base}/api/purchase/demo/confirm`, { data: { orderId: order.id, action: "complete" } })).status(), 200);
    const { subscriptions } = await (await api.get(`${base}/api/subscription`)).json();
    const source = subscriptions.find(item => item.scope === "category" && item.state === "active");
    assert.ok(source);
    const { quote, plan } = await (await api.post(`${base}/api/subscription/quote`, { data: { kind: "upgrade", subscriptionId: source.id } })).json();
    assert.equal(quote.creditMinor, order.amountMinor);
    assert.equal(quote.amountMinor, plan.amountMinor - order.amountMinor);
    assert.ok(quote.amountMinor > 0);
    const page = await context.newPage();
    for (const locale of ["en-GB", "zh-CN"]) {
      await page.setViewportSize({ width: 1440, height: 1206 });
      await page.goto(`${base}/${locale}/portal/subscription/confirmation?quoteId=${quote.id}`, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      const dialog = page.getByRole("dialog");
      const bounds = await dialog.boundingBox();
      assert.equal(bounds.x, 370); assert.equal(bounds.y, 54); assert.equal(bounds.width, 700);
      const summary = await dialog.locator(".upgrade-summary").boundingBox();
      assert.equal(summary.x, 410); assert.equal(summary.y, 172); assert.equal(summary.width, 620); assert.equal(summary.height, 240);
      assert.ok((await dialog.locator(".upgrade-validity").innerText()).includes(new Date(source.validTo).toLocaleDateString(locale)));
      assert.equal(await dialog.locator(".upgrade-price dd").count(), 3);
      const submit = dialog.locator(".confirmation-actions .portal-button-primary");
      assert.ok(await submit.isDisabled());
      const checks = dialog.locator("input[type=checkbox]");
      for (let index = 0; index < 3; index++) await checks.nth(index).check();
      assert.ok(await submit.isEnabled());
      for (const width of [768, 390, 320]) {
        await page.setViewportSize({ width, height: 740 });
        assert.ok(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1), `${name}/${locale}: dialog overflow at ${width}`);
      }
      await page.setViewportSize({ width: 1440, height: 1206 });
      await page.screenshot({ path: `/tmp/lg-upgrade-${name}-${locale}.png`, fullPage: true });
      await page.keyboard.press("Escape");
      await page.waitForURL(url => url.searchParams.get("upgradeFrom") === source.id);
    }
    const { order: upgrade } = await (await api.post(`${base}/api/purchase/checkout`, { data: { quoteId: quote.id, consents } })).json();
    for (let index = 0; index < 2; index++) assert.equal((await api.post(`${base}/api/purchase/demo/confirm`, { data: { orderId: upgrade.id, action: "complete" } })).status(), 200);
    const after = (await (await api.get(`${base}/api/subscription`)).json()).subscriptions;
    const target = after.filter(item => item.scope === "everything" && item.state === "active");
    assert.equal(target.length, 1, "Repeated payment must not create duplicate upgrades");
    assert.equal(target[0].validTo, source.validTo, "Upgrade must inherit the source expiry");
    assert.equal(after.find(item => item.id === source.id).cancelAtPeriodEnd, true);
    assert.equal((await api.post(`${base}/api/subscription`, { data: { subscriptionId: target[0].id, action: "cancel" } })).status(), 200);
    assert.equal((await api.post(`${base}/api/subscription`, { data: { subscriptionId: target[0].id, action: "resume" } })).status(), 400);
    await page.goto(`${base}/en-GB/account/my-learning/subscription`, { waitUntil: "networkidle" });
    assert.equal(await page.locator(".subscription-record .table-actions button").count(), 0);
    console.log(JSON.stringify({ browser: name, passed: true, actualPaymentCredit: true, expiryRetained: true, repeatedPaymentIdempotent: true, noPaidResume: true }));
  } finally { await browser.close(); }
}
