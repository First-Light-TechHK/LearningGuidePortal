import assert from "node:assert/strict";
import { test } from "node:test";
import { stop } from "esbuild";
import { isolate, setCookie, clearCookies, SESSION_COOKIE } from "./harness";
import { readProductData, writeProductData, verifiedUser } from "../unit/helpers/my-learning";
import { getMessages } from "../../lib/i18n/messages";

test("receipt errors/demo follow page locale while Stripe destinations retain the provider URL", async () => {
  const { restore } = await isolate("lg-receipt-locale-");
  const previousSecret = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = "sk_test_receipt_locale_fixture";
  try {
    const store = await import("../../services/productStore");
    const user = await verifiedUser(store, "receipt-locale@example.test");
    const token = (await store.createSession(user.id)).token;
    setCookie(SESSION_COOKIE, token);
    const order = { id: "locale-receipt", userId: user.id, planId: "everything-pc-6", quoteId: "locale-quote", kind: "purchase" as const, paymentMode: "demo" as const, status: "paid" as const, amountMinor: 9900, currency: "usd" as const, createdAt: "2026-10-21T00:00:00Z" };
    const data = await readProductData(); data.orders.push(order, { ...order, id: "provider-error", paymentMode: "stripe", stripeInvoiceId: "in_locale_error" }, { ...order, id: "stripe-success", paymentMode: "stripe", stripeInvoiceId: "in_locale_success" }); await writeProductData(data);
    const stripe = (await import("../../services/stripeClient")).getStripe();
    stripe.invoices.retrieve = (async (id:string) => {
      if(id==="in_locale_error") throw new Error("provider unavailable");
      assert.equal(id,"in_locale_success");
      return {id,status:"paid",amount_paid:9900,currency:"usd",hosted_invoice_url:"https://invoice.stripe.com/i/original?token=provider"};
    }) as unknown as typeof stripe.invoices.retrieve;
    const { GET } = await import("../../app/api/my-learning/orders/[orderId]/receipt/route");
    const request = (locale?: string, orderId = order.id) => GET(new Request(`http://localhost/api/my-learning/orders/${orderId}/receipt${locale === undefined ? "" : `?locale=${encodeURIComponent(locale)}`}`), { params: Promise.resolve({ orderId }) });
    for (const accountLocale of ["en-GB", "zh-CN"] as const) {
      const current = await readProductData(); current.users.find((u: { id: string }) => u.id === user.id).locale = accountLocale; await writeProductData(current);
      for (const pageLocale of ["en-GB", "zh-CN"] as const) {
        const copy = getMessages(pageLocale).orderReceipt;
        const response = await request(pageLocale);
        assert.equal(response.status, 200);
        const html = await response.text();
        assert.ok(html.includes(`<html lang="${pageLocale}">`));
        assert.ok(html.includes(`<h1>${copy.title}</h1>`));
        assert.ok(html.includes(`<dt>${copy.amount}</dt><dd>US$99.00</dd>`));
        assert.equal(response.headers.get("cache-control"), "private, no-store");
        const hosted=await request(pageLocale,"stripe-success");
        assert.equal(hosted.status,302);
        assert.equal(hosted.headers.get("location"),"https://invoice.stripe.com/i/original?token=provider");
        const missing = await request(pageLocale, "missing-order");
        assert.equal(missing.status, 404); assert.equal(await missing.text(), copy.unavailable);
        const providerError = await request(pageLocale, "provider-error");
        assert.equal(providerError.status, 503); assert.equal(await providerError.text(), copy.providerError);
        clearCookies();
        const signedOut = await request(pageLocale);
        assert.equal(signedOut.status, 401); assert.equal(await signedOut.text(), copy.signIn);
        setCookie(SESSION_COOKIE, token);
      }
      for (const absentOrInvalid of [undefined, "", "fr-FR", '<script>alert("x")</script>']) {
        const response = await request(absentOrInvalid);
        assert.equal(response.status, 200);
        assert.ok((await response.text()).includes(`<html lang="${accountLocale}">`));
      }
    }
  } finally {
    if (previousSecret === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = previousSecret;
    await stop(); await restore();
  }
});
