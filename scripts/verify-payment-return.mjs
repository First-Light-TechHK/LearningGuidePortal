import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.BASE_URL || "http://127.0.0.1:3011";
const browser = await chromium.launch();
try {
  const context = await browser.newContext();
  const api = context.request;
  const config = await (await api.get(base + "/api/health/config")).json();
  assert.equal(config.environment, "DEV", "This test creates local test orders only.");
  assert.equal(config.payment.mode, "demo");
  const register = await api.post(base + "/api/auth/register", { data: {
    email: `payment-return.${Date.now()}@example.test`, password: "TestPass123!", nickname: "Payment Test"
  } });
  assert.equal(register.status(), 200);
  assert.equal((await api.get(base + "/api/backoffice/portal")).status(), 403);
  assert.equal((await api.put(base + "/api/backoffice/portal", { data: {} })).status(), 403);
  const { plans } = await (await api.get(base + "/api/portal/plans")).json();
  const plan = plans.find((item) => item.scope === "category" && item.device === "pc");
  assert.ok(plan);
  const page = await context.newPage();
  for (const locale of ["en-GB", "zh-CN"]) {
    const quoteResponse = await api.post(base + "/api/purchase/quote", { data: { planId: plan.id } });
    assert.equal(quoteResponse.status(), 200);
    const { quote } = await quoteResponse.json();
    const confirmation = `/${locale}/portal/subscription/confirmation?quoteId=${encodeURIComponent(quote.id)}`;
    for (const action of ["cancel", "fail"]) {
      await page.goto(base + confirmation);
      const submit = page.locator(".subscription-confirmation .portal-button-primary");
      assert.ok(await submit.isDisabled());
      const checkboxes = page.locator(".subscription-consents input");
      assert.equal(await checkboxes.count(), 3);
      for (let i = 0; i < 3; i++) await checkboxes.nth(i).check();
      await submit.click();
      await page.waitForURL("**/portal/payment/checkout?orderId=*");
      const buttons = page.locator(".local-checkout-secondary-actions button");
      await buttons.nth(action === "cancel" ? 1 : 0).click();
      await page.waitForURL(base + confirmation);
      assert.equal(new URL(page.url()).searchParams.get("quoteId"), quote.id);
      const { overview } = await (await api.get(base + "/api/my-learning")).json();
      assert.equal(overview.entitlements.length, 0, "Unpaid orders must not grant access.");
    }
    console.log(`${locale}: cancellation and failure return to the same quote; all three consents required; no unpaid access`);
  }
} finally {
  await browser.close();
}
