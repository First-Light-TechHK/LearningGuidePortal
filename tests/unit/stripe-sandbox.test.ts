import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type Stripe from "stripe";
import { validateStripePrice } from "../../services/stripePrices";

const originalCwd = process.cwd();
let directory: string;
let store: typeof import("../../services/productStore");
let handler: typeof import("../../app/api/payment/webhook/route");
let client: typeof import("../../services/stripeClient");
let count = 0;
before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "lg-stripe-sandbox-"));
  process.chdir(directory);
  Object.assign(process.env, { APP_ENV: "DEV", STORAGE_BACKEND: "local", STRIPE_SANDBOX: "1", STRIPE_SECRET_KEY: "sk_test_fixture", STRIPE_WEBHOOK_SECRET: "whsec_fixture", EMAIL_VERIFICATION_REQUIRED: "0" });
  store = await import("../../services/productStore");
  client = await import("../../services/stripeClient");
  handler = await import("../../app/api/payment/webhook/route");
});
after(async () => { process.chdir(originalCwd); await rm(directory, { recursive: true, force: true }); });

const price = { id: "price_fixture", active: true, livemode: false, type: "recurring", billing_scheme: "per_unit", unit_amount: 7800, currency: "usd", recurring: { interval: "year", interval_count: 1, usage_type: "licensed" } } as Stripe.Price;
test("annual price validates; accidental monthly, live, amount and currency mismatches fail", () => {
  assert.equal(validateStripePrice(price, { months: 12, amountMinor: 7800 }).id, price.id);
  assert.throws(() => validateStripePrice({ ...price, recurring: { ...price.recurring!, interval: "month" } }, { months: 12 }));
  assert.throws(() => validateStripePrice({ ...price, livemode: true }, { months: 12 }));
  assert.throws(() => validateStripePrice(price, { months: 12, amountMinor: 3900 }));
  assert.throws(() => validateStripePrice({ ...price, currency: "hkd" }, { months: 12 }));
});

async function fixture() {
  const user = await store.registerUser({ email: `stripe${++count}@example.test`, password: "TestPass123!" });
  const { quote, plan } = await store.createQuote(user.id, "everything-pc-6");
  // Model an order persisted by the remote version before Price snapshots existed.
  const { order } = await store.createPendingDemoOrder(user.id, quote.id);
  const file = path.join(directory, "data", "knowledge_system", "learning_guide", "product.json");
  const data = JSON.parse(await readFile(file, "utf8"));
  data.orders.find((item: { id: string }) => item.id === order.id).paymentMode = "stripe";
  await writeFile(file, JSON.stringify(data));
  const sessionId = `cs_test_fixture_${count}`;
  await store.attachStripeCheckoutSession(user.id, order.id, sessionId);
  return { user, order, object: { id: sessionId, payment_status: "paid", amount_total: order.amountMinor, currency: order.currency, subscription: `sub_fixture_${count}`, metadata: { userId: user.id, orderId: order.id, quoteId: quote.id, planId: plan.id } } };
}

async function event(type: string, object: object, id = `evt_fixture_${++count}`, live = false) {
  const payload = JSON.stringify({ id, type, object: "event", livemode: live, data: { object } });
  const signature = client.getStripe().webhooks.generateTestHeaderString({ payload, secret: "whsec_fixture" });
  return handler.POST(new Request("http://localhost/api/payment/webhook", { method: "POST", body: payload, headers: { "stripe-signature": signature } }));
}

test("unpaid completion grants nothing; subsequent paid event grants access once", async () => {
  const f = await fixture();
  assert.equal((await event("checkout.session.completed", { ...f.object, payment_status: "unpaid" })).status, 200);
  assert.equal((await store.checkEntitlement(f.user.id, "epicureanism")).allowed, false);
  const id = `evt_paid_${count}`;
  assert.equal((await event("checkout.session.async_payment_succeeded", f.object, id)).status, 200);
  assert.equal((await store.checkEntitlement(f.user.id, "epicureanism")).allowed, true);
  assert.equal((await event("checkout.session.async_payment_succeeded", f.object, id)).status, 200);
  const overview = await store.getLearningOverview(f.user.id);
  assert.equal(overview.entitlements.length, 1);
});

for (const [type, expected] of [["checkout.session.expired", "canceled"], ["checkout.session.async_payment_failed", "failed"]]) {
  test(`${type} updates the order without granting course access`, async () => {
    const f = await fixture();
    assert.equal((await event(type, f.object)).status, 200);
    assert.equal((await store.getOrderForUser(f.user.id, f.order.id))?.status, expected);
    assert.equal((await store.checkEntitlement(f.user.id, "epicureanism")).allowed, false);
  });
}

test("late failure cannot remove a successful purchase", async () => {
  const f = await fixture();
  await event("checkout.session.completed", f.object);
  await event("checkout.session.expired", f.object);
  assert.equal((await store.getOrderForUser(f.user.id, f.order.id))?.status, "paid");
  assert.equal((await store.checkEntitlement(f.user.id, "epicureanism")).allowed, true);
});

test("amount mismatch, bad signatures and live events cannot grant access", async () => {
  const f = await fixture();
  const retryId = `evt_retry_${count}`;
  assert.equal((await event("checkout.session.completed", { ...f.object, amount_total: 1 }, retryId)).status, 500);
  assert.equal((await event("checkout.session.completed", f.object, `evt_live_${count}`, true)).status, 500);
  assert.equal((await handler.POST(new Request("http://localhost/api/payment/webhook", { method: "POST", body: "{}", headers: { "stripe-signature": "invalid" } }))).status, 400);
  assert.equal((await store.checkEntitlement(f.user.id, "epicureanism")).allowed, false);
  assert.equal((await event("checkout.session.completed", f.object, retryId)).status, 200);
});

test("invoice processing retries after a provider failure and accepts current Stripe subscription fields", async () => {
  const f = await fixture();
  await event("checkout.session.completed", f.object);
  const stripe = client.getStripe();
  const retrieve = stripe.subscriptions.retrieve;
  const id = `evt_invoice_${count}`;
  const invoice = { id: `in_fixture_${count}`, amount_paid: 9900, parent: { subscription_details: { subscription: f.object.subscription } } };
  try {
    stripe.subscriptions.retrieve = (async () => { throw new Error("Temporary provider failure"); }) as typeof retrieve;
    assert.equal((await event("invoice.paid", invoice, id)).status, 500);
    stripe.subscriptions.retrieve = (async () => ({ status: "active", items: { data: [{ current_period_start: 1800000000, current_period_end: 1815552000 }] } })) as unknown as typeof retrieve;
    assert.equal((await event("invoice.paid", invoice, id)).status, 200);
    assert.equal((await event("invoice.paid", invoice, id)).status, 200);
    const order = await store.getOrderForUser(f.user.id, f.order.id);
    assert.equal(order?.stripeInvoiceId, invoice.id);
    assert.equal(order?.servicePeriodEnd, new Date(1815552000 * 1000).toISOString());
  } finally { stripe.subscriptions.retrieve = retrieve; }
});
