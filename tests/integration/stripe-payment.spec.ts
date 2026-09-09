import { expect, test } from "playwright/test";
import type Stripe from "stripe";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { subscriptionPrices } from "../../contracts/payment";

test.describe.configure({ mode: "serial" });
let store: typeof import("../../services/productStore");
let payment: typeof import("../../services/paymentService");
let prices: typeof import("../../services/stripePriceService");
let webhook: typeof import("../../app/api/payment/webhook/route");
let stripe: Stripe;
let directory: string;
const cwd = process.cwd();
const environment = { ...process.env };
const catalog = new Map<string, Stripe.Price>();
const sessions = new Map<string, Stripe.Checkout.Session>();
const subscriptions = new Map<string, Stripe.Subscription>();
const invoices = new Map<string, Stripe.Invoice>();
const requests: Array<{ input: Stripe.Checkout.SessionCreateParams; options?: Stripe.RequestOptions }> = [];
const secret = "whsec_fake_payment_test_only";

test.beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "learning-guide-payment-"));
  process.chdir(directory);
  Object.assign(process.env, { STORAGE_BACKEND: "local", APP_ENV: "DEV", PAYMENT_MODE: "stripe", STRIPE_SANDBOX: "1", STRIPE_SECRET_KEY: "sk_test_fake_only", STRIPE_WEBHOOK_SECRET: secret, NEXT_PUBLIC_APP_URL: "https://payment.example.test" });
  for (const mapping of subscriptionPrices) {
    process.env[mapping.env] = mapping.id;
    catalog.set(mapping.id, { id: "price_" + mapping.id, active: true, lookup_key: mapping.id, type: "recurring", currency: "usd", unit_amount: mapping.scope === "everything" ? mapping.termMonths === 6 ? 9900 : 19800 : mapping.termMonths === 6 ? 3900 : 7800,
      billing_scheme: "per_unit", transform_quantity: null, recurring: { interval: mapping.termMonths === 6 ? "month" : "year", interval_count: mapping.termMonths === 6 ? 6 : 1, usage_type: "licensed" } } as Stripe.Price);
  }
  store = await import("../../services/productStore");
  payment = await import("../../services/paymentService");
  prices = await import("../../services/stripePriceService");
  webhook = await import("../../app/api/payment/webhook/route");
  stripe = (await import("../../services/stripeClient")).getStripe();
  stripe.prices.list = (async (input: { lookup_keys: string[] }) => ({ data: input.lookup_keys.map(key => catalog.get(key)).filter(Boolean) })) as typeof stripe.prices.list;
  stripe.prices.retrieve = (async (id: string) => [...catalog.values()].find(item => item.id === id)) as typeof stripe.prices.retrieve;
  stripe.checkout.sessions.create = (async (input: Stripe.Checkout.SessionCreateParams, options?: Stripe.RequestOptions) => {
    requests.push({ input, options });
    const id = "cs_" + options?.idempotencyKey;
    if (!sessions.has(id)) sessions.set(id, { id, url: "https://checkout.stripe.test/" + id, status: "open", payment_status: "unpaid", mode: input.mode, metadata: input.metadata, currency: "usd" } as Stripe.Checkout.Session);
    return sessions.get(id);
  }) as typeof stripe.checkout.sessions.create;
  stripe.checkout.sessions.retrieve = (async (id: string) => sessions.get(id)) as typeof stripe.checkout.sessions.retrieve;
  stripe.checkout.sessions.list = (async (input: { subscription: string }) => ({ data: [...sessions.values()].filter(item => (typeof item.subscription === "string" ? item.subscription : item.subscription?.id) === input.subscription).slice(0, 1) })) as typeof stripe.checkout.sessions.list;
  stripe.subscriptions.retrieve = (async (id: string) => subscriptions.get(id)) as typeof stripe.subscriptions.retrieve;
  stripe.subscriptions.update = (async (id: string, input: Stripe.SubscriptionUpdateParams) => {
    const subscription = subscriptions.get(id)!;
    subscription.items.data[0].price = [...catalog.values()].find(item => item.id === input.items?.[0].price)!;
    return subscription;
  }) as typeof stripe.subscriptions.update;
  stripe.invoices.retrieve = (async (id: string) => invoices.get(id)) as typeof stripe.invoices.retrieve;
  stripe.invoicePayments.list = (async () => ({ data: [] })) as unknown as typeof stripe.invoicePayments.list;
});

test.afterAll(async () => {
  process.chdir(cwd); process.env = environment;
  if (directory && path.dirname(directory) === tmpdir()) await rm(directory, { recursive: true, force: true });
});

async function user() { return store.getOrCreateSocialUser({ provider: "wechat", providerSubject: "payment:" + Math.random() }); }
const consent = { renewal: true, terms: true, refund: true };
const request = () => new Request("https://payment.example.test/api/purchase/checkout", { method: "POST", headers: { origin: "https://payment.example.test" } });
async function checkout(planId = "everything-pc-6", trial = false) {
  const buyer = await user();
  const { quote } = await store.createQuote(buyer.id, planId, trial ? "trial" : "purchase");
  const result = await payment.startPayment(buyer, { quoteId: quote.id, consents: consent }, request(), trial);
  return { buyer, quote, ...result };
}
function paidSession(order: Awaited<ReturnType<typeof checkout>>["order"], trial = false) {
  const start = Math.floor(Date.now() / 1000);
  const end = start + (trial ? 3 : 180) * 86400;
  const subscription = { id: "sub_" + order.id, metadata: { app: "learning_guide", orderId: order.id }, customer: "cus_" + order.userId, status: trial ? "trialing" : "active", cancel_at_period_end: false, trial_end: trial ? end : null,
    items: { data: [{ id: "si_" + order.id, current_period_start: start, current_period_end: end, price: [...catalog.values()].find(item => item.id === order.price!.stripePriceId) }] } } as unknown as Stripe.Subscription;
  subscriptions.set(subscription.id, subscription);
  const session = sessions.get(order.stripeCheckoutSessionId!)!;
  Object.assign(session, { status: "complete", payment_status: trial ? "no_payment_required" : "paid", amount_total: order.amountMinor, subscription,
    line_items: { has_more: false, data: [{ quantity: 1, price: { id: order.price!.stripePriceId } }] } });
  return { session, subscription, start, end };
}
async function send(type: string, id: string, objectId: string, signature?: string) {
  const payload = JSON.stringify({ id, type, data: { object: { id: objectId } } });
  const header = signature || stripe.webhooks.generateTestHeaderString({ payload, secret });
  return webhook.POST(new Request("https://payment.example.test/api/payment/webhook", { method: "POST", headers: { "stripe-signature": header }, body: payload }));
}

test("all eight lookup keys produce the correct subscription period and server price", async () => {
  for (const mapping of subscriptionPrices) {
    const result = await checkout(mapping.id);
    expect(result.quote.price?.termMonths).toBe(mapping.termMonths);
    const call = requests.at(-1)!;
    expect(call.input.mode).toBe("subscription");
    expect(call.input.line_items).toEqual([{ price: "price_" + mapping.id, quantity: 1 }]);
    expect(call.input.customer_email).toBeUndefined();
    expect(call.input.managed_payments).toEqual({ enabled: false });
    expect(call.options?.idempotencyKey).toContain(result.order.id);
  }
});

test("wrong yearly interval, inactive, metered and missing prices fail closed", async () => {
  const entry = catalog.get("science-pc-12")!;
  for (const override of [{ active: false }, { recurring: { interval: "month", interval_count: 1, usage_type: "licensed" } }, { type: "one_time" }, { currency: "eur" }, { unit_amount: 0 }]) {
    catalog.set("science-pc-12", { ...entry, ...override } as Stripe.Price);
    await expect(prices.resolveSubscriptionPrice("science-pc-12")).rejects.toMatchObject({ code: "price_unavailable" });
    expect((await store.listPlans()).find(item => item.id === "science-pc-12")?.available).toBe(false);
  }
  catalog.set("science-pc-12", entry);
  await expect(prices.resolveSubscriptionPrice("untrusted-client-price")).rejects.toMatchObject({ code: "price_unavailable" });
});

test("duplicate clicks reuse one Checkout and quotes cannot be used by another account", async () => {
  const result = await checkout();
  const repeated = await payment.startPayment(result.buyer, { quoteId: result.quote.id, consents: consent }, request());
  expect(repeated.order.id).toBe(result.order.id);
  expect(repeated.checkoutUrl).toBe(result.checkoutUrl);
  await expect(payment.startPayment(await user(), { quoteId: result.quote.id, consents: consent }, request())).rejects.toMatchObject({ code: "quote_expired" });
  await expect(payment.startPayment(result.buyer, { quoteId: result.quote.id }, request())).rejects.toMatchObject({ code: "invalid_request" });
  await expect(payment.startPayment(result.buyer, { quoteId: result.quote.id, consents: consent }, new Request("https://payment.example.test"))).rejects.toMatchObject({ code: "invalid_request" });
});

test("quote pins price ID even after lookup key transfer and expires safely", async () => {
  const result = await checkout();
  const file = path.join(directory, "data/knowledge_system/learning_guide/product.json");
  const data = JSON.parse(await readFile(file, "utf8"));
  data.plans.find((item: { id: string }) => item.id === result.quote.planId).amountMinor = 1;
  await writeFile(file, JSON.stringify(data));
  expect((await store.getQuoteForUser(result.buyer.id, result.quote.id))?.plan.amountMinor).toBe(9900);
  data.quotes.find((item: { id: string }) => item.id === result.quote.id).expiresAt = "2000-01-01T00:00:00Z";
  await writeFile(file, JSON.stringify(data));
  await expect(payment.startPayment(result.buyer, { quoteId: result.quote.id, consents: consent }, request())).rejects.toMatchObject({ code: "quote_expired" });
});

test("webhook signature and unpaid sessions never grant access", async () => {
  const result = await checkout();
  expect((await send("checkout.session.completed", "evt_bad", result.order.stripeCheckoutSessionId!, "bad")).status).toBe(400);
  expect((await send("checkout.session.completed", "evt_unpaid", result.order.stripeCheckoutSessionId!)).status).toBe(200);
  expect((await store.getLearningOverview(result.buyer.id)).entitlements).toHaveLength(0);
});

test("verified payment fulfils once; wrong amount and price retry without consuming event", async () => {
  const result = await checkout();
  const { session } = paidSession(result.order);
  session.amount_total = 1;
  expect((await send("checkout.session.completed", "evt_retry", session.id)).status).toBe(500);
  session.amount_total = result.order.amountMinor;
  session.line_items!.data[0].price!.id = "price_wrong";
  expect((await send("checkout.session.completed", "evt_retry", session.id)).status).toBe(500);
  session.line_items!.data[0].price!.id = result.order.price!.stripePriceId;
  expect((await send("checkout.session.completed", "evt_retry", session.id)).status).toBe(200);
  expect((await send("checkout.session.completed", "evt_retry", session.id)).status).toBe(200);
  expect((await send("checkout.session.async_payment_succeeded", "evt_second", session.id)).status).toBe(200);
  expect((await store.getLearningOverview(result.buyer.id)).subscriptions).toHaveLength(1);
});

test("invoice before checkout, renewals and cancellation reconcile using current Stripe state", async () => {
  const result = await checkout();
  const { session, subscription, start, end } = paidSession(result.order);
  const invoice = { id: "in_first", parent: { subscription_details: { subscription: subscription.id } }, currency: "usd", amount_paid: result.order.amountMinor, status: "paid", billing_reason: "subscription_create", lines: { has_more: false, data: [{ period: { start, end }, pricing: { price_details: { price: result.order.price!.stripePriceId } } }] } } as unknown as Stripe.Invoice;
  invoices.set(invoice.id, invoice);
  expect((await send("invoice.paid", "evt_invoice_first", invoice.id)).status).toBe(200);
  expect((await send("checkout.session.completed", "evt_checkout_late", session.id)).status).toBe(200);
  expect((await store.getLearningOverview(result.buyer.id)).subscriptions).toHaveLength(1);
  const renewed = { ...invoice, id: "in_renew", billing_reason: "subscription_cycle", lines: { ...invoice.lines, data: [{ ...invoice.lines.data[0], period: { start: end, end: end + 180 * 86400 } }] } } as Stripe.Invoice;
  invoices.set(renewed.id, renewed);
  expect((await send("invoice.paid", "evt_renew", renewed.id)).status).toBe(200);
  subscription.cancel_at_period_end = true;
  expect((await send("customer.subscription.updated", "evt_cancel", subscription.id)).status).toBe(200);
  expect((await store.getLearningOverview(result.buyer.id)).subscriptions[0].cancelAtPeriodEnd).toBe(true);
  subscription.status = "canceled";
  expect((await send("customer.subscription.deleted", "evt_deleted", subscription.id)).status).toBe(200);
  expect((await store.checkEntitlement(result.buyer.id, "epicureanism")).allowed).toBe(false);
});

test("free trial invoice does not convert trial into paid subscription", async () => {
  const result = await checkout("everything-pc-6", true);
  const { session, subscription, start, end } = paidSession(result.order, true);
  expect((await send("checkout.session.completed", "evt_trial", session.id)).status).toBe(200);
  invoices.set("in_trial", { id: "in_trial", parent: { subscription_details: { subscription: subscription.id } }, currency: "usd", amount_paid: 0, status: "paid", billing_reason: "subscription_create", lines: { has_more: false, data: [{ period: { start, end } }] } } as unknown as Stripe.Invoice);
  expect((await send("invoice.paid", "evt_trial_invoice", "in_trial")).status).toBe(200);
  expect((await store.getLearningOverview(result.buyer.id)).subscriptions[0].source).toBe("trial");
});

test("failed invoice grace is stable and recovery restores expired access", async () => {
  const result = await checkout();
  const { session, subscription, start, end } = paidSession(result.order);
  await send("checkout.session.completed", "evt_grace_start", session.id);
  subscription.status = "past_due";
  invoices.set("in_failed", { id: "in_failed", parent: { subscription_details: { subscription: subscription.id } }, currency: "usd", amount_paid: 0, status: "open", billing_reason: "subscription_cycle", lines: { has_more: false, data: [{ period: { start: end, end: end + 180 * 86400 } }] } } as unknown as Stripe.Invoice);
  expect((await send("invoice.payment_failed", "evt_grace", "in_failed")).status).toBe(200);
  const first = (await store.getLearningOverview(result.buyer.id)).subscriptions[0];
  expect(first.state).toBe("grace");
  expect((await send("invoice.payment_failed", "evt_grace_again", "in_failed")).status).toBe(200);
  expect((await store.getLearningOverview(result.buyer.id)).subscriptions[0].validTo).toBe(first.validTo);
  subscription.status = "active";
  invoices.get("in_failed")!.status = "paid";
  invoices.get("in_failed")!.amount_paid = result.order.amountMinor;
  expect((await send("invoice.paid", "evt_recovery", "in_failed")).status).toBe(200);
  expect((await store.getLearningOverview(result.buyer.id)).subscriptions[0].state).toBe("active");
  expect(start).toBeLessThan(end);
});

test("upgrade collects the difference once and changes the existing recurring subscription", async () => {
  const result = await checkout("european-humanities-pc-6");
  const { session, subscription, end } = paidSession(result.order);
  expect((await send("checkout.session.completed", "evt_upgrade_source", session.id)).status).toBe(200);
  const source = (await store.getLearningOverview(result.buyer.id)).subscriptions[0];
  const { quote } = await store.createUpgradeQuote(result.buyer.id, source.id);
  expect(quote.amountMinor).toBe(6000);
  const upgraded = await payment.startPayment(result.buyer, { quoteId: quote.id, consents: consent }, request());
  const upgradeSession = sessions.get(upgraded.order.stripeCheckoutSessionId!)!;
  Object.assign(upgradeSession, { status: "complete", payment_status: "paid", amount_total: 6000, line_items: { has_more: false, data: [{ quantity: 1 }] } });
  expect((await send("checkout.session.completed", "evt_upgrade_paid", upgradeSession.id)).status).toBe(200);
  expect((await send("checkout.session.completed", "evt_upgrade_paid", upgradeSession.id)).status).toBe(200);
  expect(subscription.items.data[0].price.id).toBe("price_everything-pc-6");
  const active = (await store.getLearningOverview(result.buyer.id)).subscriptions.filter(item => item.state === "active");
  expect(active).toHaveLength(1);
  expect(active[0].stripeSubscriptionId).toBe(subscription.id);
  expect(active[0].validTo).toBe(new Date(end * 1000).toISOString());
  expect(active[0].stripeCustomerId).toBe(source.stripeCustomerId);
});
