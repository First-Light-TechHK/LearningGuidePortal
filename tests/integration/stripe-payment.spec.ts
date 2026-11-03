import { expect, test } from "playwright/test";
import "./helpers/preload-native-modules";
import type Stripe from "stripe";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { createRequire } from "node:module";
import { build, stop } from "esbuild";
import { paymentFailure } from "../../services/paymentHttp";
import { subscriptionPrices } from "../../contracts/payment";
import * as productStore from "../../services/productStore";
import * as paymentService from "../../services/paymentService";
import * as stripePriceService from "../../services/stripePriceService";
import { getStripe } from "../../services/stripeClient";
import { presentSubscriptionOrders } from "../../services/subscriptionPresentationService";
import { hydrateOrmFromSql } from "../../services/ormRuntime";
import * as paymentWebhook from "../../app/api/payment/webhook/route";
import * as orderPayments from "../../services/orderPaymentService";
import * as orderHttp from "../../services/orderManagementHttp";
import * as orderContract from "../../contracts/order-management";
import { actOnOperatorOrder } from "../../services/operatorOrderService";

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
const previews: Stripe.InvoiceCreatePreviewParams[] = [];
const updates: Array<{ input: Stripe.SubscriptionUpdateParams; options?: Stripe.RequestOptions }> = [];
const updateInvoices = new Map<string, Stripe.Invoice>();
let upgradePaymentPending = false, upgradePreviewAmount = 3586, loseUpgradeResponse = false;
let webhookBeforeUpgradeResponse = false;
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
  store = productStore;
  for (const [months,key,env] of [[6,"lg_upgrade_60","STRIPE_PRICE_UPGRADE_SIX_MONTHS"],[12,"lg_upgrade_120","STRIPE_PRICE_UPGRADE_ONE_YEAR"]] as const) {
    process.env[env]=key;
    catalog.set(key,{id:"price_"+key,active:true,lookup_key:key,type:"one_time",currency:"usd",unit_amount:months===6?6000:12000,billing_scheme:"per_unit",transform_quantity:null,recurring:null,livemode:false} as Stripe.Price);
  }
  payment = paymentService;
  prices = stripePriceService;
  webhook = paymentWebhook;
  stripe = getStripe();
  stripe.prices.list = (async (input: { lookup_keys: string[] }) => ({ data: input.lookup_keys.map(key => catalog.get(key)).filter(Boolean) })) as typeof stripe.prices.list;
  stripe.prices.retrieve = (async (id: string) => [...catalog.values()].find(item => item.id === id)) as typeof stripe.prices.retrieve;
  stripe.checkout.sessions.create = (async (input: Stripe.Checkout.SessionCreateParams, options?: Stripe.RequestOptions) => {
    const checkoutOrigin = test.info().title.startsWith("DEV checkout") ? "http://127.0.0.1:3011" : "https://payment.example.test";
    expect(input.success_url).toBe(`${checkoutOrigin}/en-GB/account/my-learning/subscription?orderId=${encodeURIComponent(String(input.metadata?.orderId))}`);
    requests.push({ input, options });
    const id = "cs_" + options?.idempotencyKey;
    if (!sessions.has(id)) sessions.set(id, { id, url: "https://checkout.stripe.test/" + id, status: "open", payment_status: "unpaid", mode: input.mode, metadata: input.metadata, currency: "usd" } as Stripe.Checkout.Session);
    return sessions.get(id);
  }) as typeof stripe.checkout.sessions.create;
  stripe.checkout.sessions.retrieve = (async (id: string) => sessions.get(id)) as typeof stripe.checkout.sessions.retrieve;
  stripe.checkout.sessions.expire = (async (id: string) => {
    const session = sessions.get(id)!;
    if (session.status !== "open") throw new Error("Session is no longer open.");
    session.status = "expired"; return session;
  }) as typeof stripe.checkout.sessions.expire;
  stripe.checkout.sessions.list = (async (input: { subscription: string }) => ({ data: [...sessions.values()].filter(item => (typeof item.subscription === "string" ? item.subscription : item.subscription?.id) === input.subscription).slice(0, 1) })) as typeof stripe.checkout.sessions.list;
  stripe.subscriptions.retrieve = (async (id: string) => subscriptions.get(id)) as typeof stripe.subscriptions.retrieve;
  stripe.invoices.createPreview = (async (input: Stripe.InvoiceCreatePreviewParams) => {
    previews.push(input);
    const sub = subscriptions.get(input.subscription!)!, item = sub.items.data[0], start = input.subscription_details!.proration_date!;
    return { id: "upcoming", currency: "usd", amount_due: upgradePreviewAmount, total: upgradePreviewAmount, lines: { has_more: false, data: [-1200, upgradePreviewAmount + 1200].map(amount => ({ amount, parent: { subscription_item_details: { proration: true, subscription_item: item.id } }, period: { start, end: item.current_period_end } })) } };
  }) as typeof stripe.invoices.createPreview;
  stripe.subscriptions.update = (async (id: string, input: Stripe.SubscriptionUpdateParams, options?: Stripe.RequestOptions) => {
    const subscription = subscriptions.get(id)!;
    if (input.payment_behavior === "pending_if_incomplete") {
      updates.push({ input, options });
      const key = options!.idempotencyKey!;
      let invoice = updateInvoices.get(key);
      if (!invoice) {
        const preview = await stripe.invoices.createPreview({ subscription: id, subscription_details: { proration_date: input.proration_date } });
        invoice = { ...preview, id: "in_upgrade_" + key, customer: subscription.customer, parent: { subscription_details: { subscription: id } }, created: Math.floor(Date.now() / 1000), status: upgradePaymentPending ? "open" : "paid", billing_reason: "subscription_update", amount_paid: upgradePaymentPending ? 0 : upgradePreviewAmount, hosted_invoice_url: "https://invoice.stripe.test/" + key } as unknown as Stripe.Invoice;
        invoices.set(invoice.id, invoice); updateInvoices.set(key, invoice);
        subscription.pending_update = upgradePaymentPending ? { expires_at: Math.floor(Date.now() / 1000) + 86400 } as Stripe.Subscription.PendingUpdate : null;
        if (!upgradePaymentPending) subscription.items.data[0].price = [...catalog.values()].find(item => item.id === input.items?.[0].price)!;
        subscription.latest_invoice = invoice;
      }
      if (webhookBeforeUpgradeResponse) {
        webhookBeforeUpgradeResponse = false;
        expect((await send("invoice.paid", "evt_before_response_" + invoice.id, invoice.id)).status).toBe(200);
      }
      if (loseUpgradeResponse) { loseUpgradeResponse = false; throw new Error("Stripe response lost after update"); }
      return subscription;
    }
    subscription.items.data[0].price = [...catalog.values()].find(item => item.id === input.items?.[0].price)!;
    return subscription;
  }) as typeof stripe.subscriptions.update;
  stripe.invoices.retrieve = (async (id: string) => invoices.get(id)) as typeof stripe.invoices.retrieve;
  stripe.invoices.voidInvoice = (async (id: string) => {
    const invoice = invoices.get(id)!;
    if (invoice.status !== "open") throw new Error("Invoice is no longer open.");
    invoice.status = "void";
    const subscriptionId = typeof invoice.parent?.subscription_details?.subscription === "string" ? invoice.parent.subscription_details.subscription : invoice.parent?.subscription_details?.subscription?.id;
    if (subscriptionId) subscriptions.get(subscriptionId)!.pending_update = null;
    return invoice;
  }) as typeof stripe.invoices.voidInvoice;
  stripe.invoicePayments.list = (async () => ({ data: [] })) as unknown as typeof stripe.invoicePayments.list;
});

test.afterAll(async () => {
  stop();
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
  const termEnd = new Date(start * 1000);
  termEnd.setUTCMonth(termEnd.getUTCMonth() + order.price!.termMonths);
  const end = trial ? start + 3 * 86400 : Math.floor(termEnd.getTime() / 1000);
  const subscription = { id: "sub_" + order.id, metadata: { app: "learning_guide", orderId: order.id }, customer: "cus_" + order.userId, status: trial ? "trialing" : "active", cancel_at_period_end: false, trial_end: trial ? end : null, billing_cycle_anchor: start, collection_method: "charge_automatically", latest_invoice: { id: "in_source_" + order.id, status: "paid" },
    items: { data: [{ id: "si_" + order.id, quantity: 1, current_period_start: start, current_period_end: end, price: [...catalog.values()].find(item => item.id === order.price!.stripePriceId) }] } } as unknown as Stripe.Subscription;
  subscriptions.set(subscription.id, subscription);
  const session = sessions.get(order.stripeCheckoutSessionId!)!;
  Object.assign(session, { status: "complete", payment_status: trial ? "no_payment_required" : "paid", amount_total: order.amountMinor, subscription, customer: subscription.customer,
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
    const { session, start, end } = paidSession(result.order);
    expect((await send("checkout.session.completed", `evt_term_${mapping.id}`, session.id)).status).toBe(200);
    const overview = await store.getLearningOverview(result.buyer.id);
    const subscription = overview.subscriptions.find(item => item.plan?.id === mapping.id)!;
    expect(subscription.validFrom).toBe(new Date(start * 1000).toISOString());
    expect(subscription.validTo).toBe(new Date(end * 1000).toISOString());
    const expectedEnd = new Date(start * 1000);
    expectedEnd.setUTCMonth(expectedEnd.getUTCMonth() + mapping.termMonths);
    expect(subscription.validTo).toBe(expectedEnd.toISOString());
  }
});

test("subscription records use purchased product imagery and term, including legacy prices", async () => {
  const price = catalog.get("chinese-humanities-pc-6")!;
  price.product = { id: "prod_chinese", name: "Chinese Humanities", images: ["https://images.example.test/chinese.jpg"] } as Stripe.Product;
  const result = await checkout("chinese-humanities-pc-6");
  expect(result.order.price).toMatchObject({ productName: "Chinese Humanities", productImage: "https://images.example.test/chinese.jpg", termMonths: 6 });
  const overview = await store.getLearningOverview(result.buyer.id);
  const orders = await presentSubscriptionOrders(overview.orders);
  expect(orders[0].presentation).toEqual({ name: "Chinese Humanities", image: "https://images.example.test/chinese.jpg", termMonths: 6 });
  const { productName, productImage, ...legacyPrice } = result.order.price!;
  const legacy = await presentSubscriptionOrders([{ ...overview.orders[0], price: legacyPrice }]);
  expect(legacy[0].presentation).toEqual(orders[0].presentation);
  const localFallback = await presentSubscriptionOrders([{
    ...overview.orders[0],
    plan: { name: "Science", scope: "category", scopeId: "Science", termMonths: 6 },
    price: { ...legacyPrice, stripePriceId: "price_science-pc-6", productName: "Science" }
  }]);
  expect(localFallback[0].presentation).toEqual({ name: "Science", image: "/portal/subscriptions/science.png", termMonths: 6 });

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
  await expect(payment.startPayment(result.buyer, { quoteId: result.quote.id }, request())).rejects.toMatchObject({ code: "consent_required" });
  await expect(payment.startPayment(result.buyer, { quoteId: result.quote.id, consents: consent }, new Request("https://payment.example.test"))).rejects.toMatchObject({ code: "origin_mismatch" });
});

test("DEV checkout accepts the actual loopback origin with a different configured address", async () => {
  const buyer = await user();
  const { quote } = await store.createQuote(buyer.id, "science-pc-6");
  const local = new Request("http://127.0.0.1:3011/api/purchase/checkout", { method: "POST", headers: { origin: "http://127.0.0.1:3011" } });
  const result = await payment.startPayment(buyer, { quoteId: quote.id, consents: consent }, local);
  expect(result.order.checkoutOrigin).toBe("http://127.0.0.1:3011");
  expect(result.checkoutUrl).toContain("https://checkout.stripe.test/");
  const foreign = new Request(local.url, { method: "POST", headers: { origin: "https://attacker.invalid" } });
  await expect(payment.startPayment(buyer, { quoteId: quote.id, consents: consent }, foreign)).rejects.toMatchObject({ code: "origin_mismatch", status: 403 });
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

test("paid scope blocks both terms and stale Checkout retries, while a different category and paid retry remain valid", async () => {
  const result = await checkout("science-pc-6");
  const stale = await store.createQuote(result.buyer.id, "science-pc-12");
  await expect(payment.startPayment(result.buyer, { quoteId: stale.quote.id, consents: consent }, request())).rejects.toMatchObject({ code: "payment_pending", blockingOrderId: result.order.id });
  // Historical deployments could create competing attempts before the pending-order guard.
  const historical = { ...result.order, id: "order_historical_competing", quoteId: stale.quote.id, planId: stale.quote.planId, price: stale.quote.price, planSnapshot: stale.quote.planSnapshot, amountMinor: stale.quote.amountMinor, stripeCheckoutSessionId: "cs_historical_competing" };
  const file = path.join(directory, "data/knowledge_system/learning_guide/product.json"), data = JSON.parse(await readFile(file, "utf8"));
  data.orders.unshift(historical); await writeFile(file, JSON.stringify(data));
  const { session } = paidSession(result.order);
  expect((await send("checkout.session.completed", "evt_duplicate_scope", session.id)).status).toBe(200);
  const count = requests.length;
  for (const term of [6, 12]) await expect(store.createQuote(result.buyer.id, `science-pc-${term}`)).rejects.toMatchObject({ code: "already_subscribed" });
  await expect(payment.startPayment(result.buyer, { quoteId: stale.quote.id, consents: consent }, request())).rejects.toMatchObject({ code: "already_subscribed" });
  await expect(store.prepareStripeCheckout(result.buyer.id, historical.id, "https://payment.example.test", "en-GB")).rejects.toMatchObject({ code: "already_subscribed" });
  expect(requests).toHaveLength(count);
  const repeated = await payment.startPayment(result.buyer, { quoteId: result.quote.id, consents: consent }, request());
  expect(repeated.order.id).toBe(result.order.id);
  expect(repeated.checkoutUrl).toContain("/account/my-learning/subscription");
  const different = await store.createQuote(result.buyer.id, "chinese-humanities-pc-12");
  await payment.startPayment(result.buyer, { quoteId: different.quote.id, consents: consent }, request());
  expect(requests).toHaveLength(count + 1);
  expect((await store.getLearningOverview(result.buyer.id)).subscriptions).toHaveLength(1);
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
  expect((await send("checkout.session.completed", "evt_retry", session.id)).status).toBe(400);
  session.amount_total = result.order.amountMinor;
  session.line_items!.data[0].price!.id = "price_wrong";
  expect((await send("checkout.session.completed", "evt_retry", session.id)).status).toBe(400);
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

async function upgradeSource(months: 6 | 12 = 6) {
  const result = await checkout(`european-humanities-pc-${months}`);
  const remote = paidSession(result.order);
  expect((await send("checkout.session.completed", "evt_source_" + result.order.id, remote.session.id)).status).toBe(200);
  const source = (await store.getLearningOverview(result.buyer.id)).subscriptions[0];
  return { ...result, ...remote, source };
}

async function hydrateQuoteWithJsonbKeyOrder(quoteId: string) {
  const file = path.join(directory, "data/knowledge_system/learning_guide/product.json");
  const data = JSON.parse(await readFile(file, "utf8"));
  const original = data.quotes.find((quote: { id: string }) => quote.id === quoteId);
  const payload = structuredClone(original);
  // JSONB does not retain insertion order. Exercise the same ORM hydration
  // used by the deployed store with the provider snapshot's keys reordered.
  payload.upgradeProration = Object.fromEntries(Object.entries(payload.upgradeProration).sort(([a], [b]) => a.length - b.length || a.localeCompare(b)));
  expect(payload.upgradeProration).toEqual(original.upgradeProration);
  expect(JSON.stringify(payload.upgradeProration)).not.toBe(JSON.stringify(original.upgradeProration));
  await hydrateOrmFromSql(data, { query: async sql => ({ rows: sql === "SELECT table_name, id, payload FROM orm_rows" ? [{ table_name: "quotes", id: quoteId, payload }] : [] }) });
  await writeFile(file, JSON.stringify(data));
}

test("fresh upgrade quotes remain payable after JSONB field reordering while changed values remain rejected", async () => {
  const source = await upgradeSource();
  const { quote } = await store.createUpgradeQuote(source.buyer.id, source.source.id);
  await hydrateQuoteWithJsonbKeyOrder(quote.id);
  const file = path.join(directory, "data/knowledge_system/learning_guide/product.json");
  const persisted = JSON.parse(await readFile(file, "utf8"));
  const count = updates.length;
  for (const field of ["itemId", "periodStart", "periodEnd", "billingCycleAnchor", "debitMinor", "creditMinor", "adjustmentsMinor", "invoiceTotalMinor", "amountDueMinor"]) {
    const changed = structuredClone(persisted);
    const snapshot = changed.quotes.find((item: { id: string }) => item.id === quote.id).upgradeProration;
    snapshot[field] = typeof snapshot[field] === "number" ? snapshot[field] + 1 : snapshot[field] + "_changed";
    await writeFile(file, JSON.stringify(changed));
    await expect(payment.startPayment(source.buyer, { quoteId: quote.id, consents: consent }, request())).rejects.toMatchObject({ code: "quote_expired" });
    expect(updates).toHaveLength(count);
    expect((await store.getLearningOverview(source.buyer.id)).orders).toHaveLength(1);
  }
  await writeFile(file, JSON.stringify(persisted));
  const result = await payment.startPayment(source.buyer, { quoteId: quote.id, consents: consent }, request());
  expect(result.order).toMatchObject({ status: "paid", amountMinor: quote.amountMinor });
  expect((await payment.startPayment(source.buyer, { quoteId: quote.id, consents: consent }, request())).order.id).toBe(result.order.id);
  expect(updates).toHaveLength(count + 1);
  expect(source.subscription.billing_cycle_anchor).toBe(source.start);
  expect(source.subscription.items.data[0].current_period_end).toBe(source.end);
});

async function purchaseCheckoutRoute() {
  const bundle = await build({ entryPoints: [path.join(cwd, "app/api/purchase/checkout/route.ts")], bundle: true, write: false, platform: "node", format: "cjs", external: ["next/server"], plugins: [{ name: "checkout-session", setup(b) {
    b.onResolve({ filter: /services\/(productAuth|paymentService|paymentHttp)$/ }, args => ({ path: args.path, namespace: "mock-checkout" }));
    b.onLoad({ filter: /.*/, namespace: "mock-checkout" }, args => ({ contents: args.path.endsWith("productAuth") ? "export async function currentProductUser(){return globalThis.stripeUpgradeCheckoutApi.user}" : args.path.endsWith("paymentHttp") ? "export const paymentFailure=(...args)=>globalThis.stripeUpgradeCheckoutApi.paymentFailure(...args)" : "export const startPayment=(...args)=>globalThis.stripeUpgradeCheckoutApi.payment.startPayment(...args)" }));
  } }] });
  const routeModule = { exports: {} as { POST: (request: Request) => Promise<Response> } };
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(path.join(cwd, "package.json")), routeModule, routeModule.exports);
  return routeModule.exports;
}

test("upgrade Continue API accepts both DEV website hosts behind a proxy without changing the billing period", async () => {
  const state = { user: null as Awaited<ReturnType<typeof user>> | null, payment, paymentFailure };
  (globalThis as any).stripeUpgradeCheckoutApi = state;
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  try {
    const route = await purchaseCheckoutRoute();
    for (const [browserOrigin, serverOrigin] of [["https://ilovelearningguide.com", "https://www.ilovelearningguide.com"], ["https://www.ilovelearningguide.com", "https://ilovelearningguide.com"]]) {
      process.env.NEXT_PUBLIC_APP_URL = configured;
      const source = await upgradeSource();
      const { quote } = await store.createUpgradeQuote(source.buyer.id, source.source.id);
      await hydrateQuoteWithJsonbKeyOrder(quote.id);
      state.user = source.buyer;
      process.env.NEXT_PUBLIC_APP_URL = serverOrigin;
      const invoke = (origin: string) => route.POST(new Request("http://localhost:8080/api/purchase/checkout", { method: "POST",
        headers: { "content-type": "application/json", origin, "x-forwarded-host": new URL(origin).host, "x-forwarded-proto": "https" },
        body: JSON.stringify({ quoteId: quote.id, consents: consent }) }));
      const count = updates.length;
      const rejected = await invoke("https://attacker.invalid");
      expect(rejected.status).toBe(403);
      expect(await rejected.json()).toMatchObject({ ok: false, code: "origin_mismatch" });
      expect(updates).toHaveLength(count);
      expect((await store.getLearningOverview(source.buyer.id)).orders).toHaveLength(1);
      const response = await invoke(browserOrigin);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toMatchObject({ ok: true, order: { status: "paid", checkoutOrigin: browserOrigin, amountMinor: quote.amountMinor } });
      expect(body.checkoutUrl).toMatch(/^\/en-GB\/account\/my-learning\/subscription\?orderId=/);
      expect(updates).toHaveLength(count + 1);
      expect(updates.at(-1)?.input.billing_cycle_anchor).toBe("unchanged");
      expect(source.subscription.billing_cycle_anchor).toBe(source.start);
      expect(source.subscription.items.data[0].current_period_end).toBe(source.end);
      expect((await invoke(browserOrigin)).status).toBe(200);
      expect(updates).toHaveLength(count + 1);
      state.user = null;
      expect((await invoke(browserOrigin)).status).toBe(401);
    }
  } finally {
    process.env.NEXT_PUBLIC_APP_URL = configured;
    delete (globalThis as any).stripeUpgradeCheckoutApi;
  }
});

for (const months of [6, 12] as const) test(`Stripe previews and upgrades the original ${months}-month subscription without moving its period`, async () => {
  const result = await upgradeSource(months), checkoutCount = requests.length;
  const { quote } = await store.createUpgradeQuote(result.buyer.id, result.source.id);
  expect(quote.amountMinor).toBe(3586);
  expect(quote.upgradePrice).toBeUndefined();
  expect(quote.upgradeProration?.creditMinor).toBe(1200);
  expect(previews.at(-1)?.subscription_details).toMatchObject({ billing_cycle_anchor: "unchanged", proration_behavior: "always_invoice", items: [{ id: result.subscription.items.data[0].id, price: `price_everything-pc-${months}`, quantity: 1 }] });
  const upgraded = await payment.startPayment(result.buyer, { quoteId: quote.id, consents: consent }, request());
  expect(requests).toHaveLength(checkoutCount);
  expect(upgraded.checkoutUrl).toContain("/account/my-learning/subscription?orderId=");
  expect(upgraded.order.stripeInvoiceId).toBeTruthy();
  expect(updates.at(-1)?.input).toMatchObject({ billing_cycle_anchor: "unchanged", payment_behavior: "pending_if_incomplete", proration_behavior: "always_invoice", proration_date: quote.upgradeProration?.prorationDate });
  expect(result.subscription.items.data[0].price.id).toBe(`price_everything-pc-${months}`);
  expect((await send("invoice.paid", `evt_upgrade_paid_${months}`, upgraded.order.stripeInvoiceId!)).status).toBe(200);
  expect((await send("invoice.paid", `evt_upgrade_paid_${months}`, upgraded.order.stripeInvoiceId!)).status).toBe(200);
  const overview = await store.getLearningOverview(result.buyer.id);
  const active = overview.subscriptions.filter(item => item.state === "active");
  expect(active).toHaveLength(1);
  expect(active[0]).toMatchObject({ stripeSubscriptionId: result.subscription.id, stripeCustomerId: result.source.stripeCustomerId, validFrom: result.source.validFrom, validTo: result.source.validTo });
  expect(overview.orders).toHaveLength(2);
  expect(result.subscription.billing_cycle_anchor).toBe(result.start);
  expect(result.subscription.items.data[0].current_period_end).toBe(result.end);
  const before = updates.length;
  expect((await payment.startPayment(result.buyer, { quoteId: quote.id, consents: consent }, request())).order.id).toBe(upgraded.order.id);
  expect(updates).toHaveLength(before);
  // A later recurring invoice renews Everything, rather than restoring Category.
  const renewal = { id: "in_after_upgrade_" + months, parent: { subscription_details: { subscription: result.subscription.id } }, currency: "usd", amount_paid: months === 6 ? 9900 : 19800, status: "paid", billing_reason: "subscription_cycle", lines: { has_more: false, data: [{ period: { start: result.end, end: result.end + 180 * 86400 }, pricing: { price_details: { price: `price_everything-pc-${months}` } } }] } } as unknown as Stripe.Invoice;
  invoices.set(renewal.id, renewal);
  result.subscription.items.data[0].current_period_start = result.end;
  result.subscription.items.data[0].current_period_end = result.end + 180 * 86400;
  expect((await send("invoice.paid", "evt_renew_after_upgrade_" + months, renewal.id)).status).toBe(200);
  expect((await store.getLearningOverview(result.buyer.id)).subscriptions.find(item => item.state === "active")?.scope).toBe("everything");
  expect((await send("invoice.paid", `evt_delayed_upgrade_${months}`, upgraded.order.stripeInvoiceId!)).status).toBe(200);
  expect((await store.getLearningOverview(result.buyer.id)).orders).toHaveLength(3);
});

test("a second Category invalidates a previous upgrade preview before Stripe is changed", async () => {
  const result = await upgradeSource();
  const { quote } = await store.createUpgradeQuote(result.buyer.id, result.source.id);
  const secondQuote = await store.createQuote(result.buyer.id, "science-pc-12");
  const second = await payment.startPayment(result.buyer, { quoteId: secondQuote.quote.id, consents: consent }, request());
  const secondPaid = paidSession(second.order);
  expect((await send("checkout.session.completed", "evt_multi_second", secondPaid.session.id)).status).toBe(200);
  const count = updates.length;
  await expect(store.createUpgradeQuote(result.buyer.id, result.source.id)).rejects.toMatchObject({ code: "upgrade_unavailable" });
  await expect(payment.startPayment(result.buyer, { quoteId: quote.id, consents: consent }, request())).rejects.toMatchObject({ code: "upgrade_unavailable" });
  expect(updates).toHaveLength(count);
});

test("declined or authentication-required upgrade keeps Category, reserves one invoice and fulfils once after payment", async () => {
  const result = await upgradeSource();
  const { quote } = await store.createUpgradeQuote(result.buyer.id, result.source.id);
  upgradePaymentPending = true;
  let upgraded: Awaited<ReturnType<typeof payment.startPayment>>;
  try { upgraded = await payment.startPayment(result.buyer, { quoteId: quote.id, consents: consent }, request()); } finally { upgradePaymentPending = false; }
  expect(upgraded.checkoutUrl).toContain("https://invoice.stripe.test/");
  const invoice = invoices.get(upgraded.order.stripeInvoiceId!)!, count = updates.length;
  await expect(store.createQuote(result.buyer.id, "science-pc-6")).rejects.toMatchObject({ code: "upgrade_in_progress" });
  await expect(store.createUpgradeQuote(result.buyer.id, result.source.id)).rejects.toMatchObject({ code: "upgrade_in_progress" });
  expect((await payment.startPayment(result.buyer, { quoteId: quote.id, consents: consent }, request())).checkoutUrl).toBe(upgraded.checkoutUrl);
  expect(updates).toHaveLength(count);
  expect((await send("invoice.payment_failed", "evt_upgrade_failed", invoice.id)).status).toBe(200);
  const current = (await store.getLearningOverview(result.buyer.id)).subscriptions.filter(item => item.state === "active");
  expect(current).toHaveLength(1); expect(current[0].scope).toBe("category");
  result.subscription.pending_update = null;
  result.subscription.items.data[0].price = catalog.get("everything-pc-6")!;
  invoice.status = "paid"; invoice.amount_paid = invoice.amount_due;
  expect((await send("invoice.paid", "evt_upgrade_recovered", invoice.id)).status).toBe(200);
  expect((await send("invoice.paid", "evt_upgrade_recovered", invoice.id)).status).toBe(200);
  const overview = await store.getLearningOverview(result.buyer.id);
  expect(overview.orders.filter(item => item.kind === "upgrade")).toHaveLength(1);
  expect(overview.subscriptions.filter(item => item.state === "active")[0].scope).toBe("everything");
});

test("voided pending upgrade releases its reservation without extending or removing Category", async () => {
  const result = await upgradeSource(), { quote } = await store.createUpgradeQuote(result.buyer.id, result.source.id);
  upgradePaymentPending = true;
  let upgraded: Awaited<ReturnType<typeof payment.startPayment>>;
  try { upgraded = await payment.startPayment(result.buyer, { quoteId: quote.id, consents: consent }, request()); } finally { upgradePaymentPending = false; }
  const invoice = invoices.get(upgraded.order.stripeInvoiceId!)!;
  invoice.status = "void"; result.subscription.pending_update = null;
  expect((await send("invoice.voided", "evt_upgrade_void", invoice.id)).status).toBe(200);
  const overview = await store.getLearningOverview(result.buyer.id);
  expect(overview.orders.find(item => item.id === upgraded.order.id)?.status).toBe("canceled");
  expect(overview.subscriptions[0]).toMatchObject({ scope: "category", state: "active", validTo: result.source.validTo });
  await store.createQuote(result.buyer.id, "science-pc-6");
});

test("upgrade reconciles an expired Category Checkout when its expiration webhook was missed", async () => {
  const result = await upgradeSource();
  const abandoned = await store.createQuote(result.buyer.id, "science-pc-6");
  const pending = await payment.startPayment(result.buyer, { quoteId: abandoned.quote.id, consents: consent }, request());
  const { quote } = await store.createUpgradeQuote(result.buyer.id, result.source.id);
  sessions.get(pending.order.stripeCheckoutSessionId!)!.status = "expired";
  const count = updates.length;
  const upgraded = await payment.startPayment(result.buyer, { quoteId: quote.id, consents: consent }, request());
  expect(upgraded.order.status).toBe("paid");
  expect(updates).toHaveLength(count + 1);
  const overview = await store.getLearningOverview(result.buyer.id);
  expect(overview.orders.find(order => order.id === pending.order.id)?.status).toBe("canceled");
  expect(overview.subscriptions.filter(item => item.state === "active")).toHaveLength(1);
  expect(overview.subscriptions.find(item => item.state === "active")?.scope).toBe("everything");
  expect((await send("checkout.session.expired", "evt_late_expired_" + pending.order.id, pending.order.stripeCheckoutSessionId!)).status).toBe(200);
  expect((await payment.startPayment(result.buyer, { quoteId: quote.id, consents: consent }, request())).order.id).toBe(upgraded.order.id);
  expect(updates).toHaveLength(count + 1);
});

test("an open Category Checkout still blocks upgrade without changing either payment", async () => {
  const result = await upgradeSource();
  const abandoned = await store.createQuote(result.buyer.id, "science-pc-6");
  const pending = await payment.startPayment(result.buyer, { quoteId: abandoned.quote.id, consents: consent }, request());
  const { quote } = await store.createUpgradeQuote(result.buyer.id, result.source.id), count = updates.length;
  await expect(payment.startPayment(result.buyer, { quoteId: quote.id, consents: consent }, request())).rejects.toMatchObject({ code: "upgrade_in_progress", status: 409 });
  expect(updates).toHaveLength(count);
  expect((await store.getLearningOverview(result.buyer.id)).orders.find(order => order.id === pending.order.id)?.status).toBe("pending");
});

test("completed Category Checkout without a webhook is fulfilled before rejecting the now-ineligible upgrade", async () => {
  const result = await upgradeSource();
  const second = await store.createQuote(result.buyer.id, "science-pc-6");
  const pending = await payment.startPayment(result.buyer, { quoteId: second.quote.id, consents: consent }, request());
  const { quote } = await store.createUpgradeQuote(result.buyer.id, result.source.id), count = updates.length;
  paidSession(pending.order);
  await expect(payment.startPayment(result.buyer, { quoteId: quote.id, consents: consent }, request())).rejects.toMatchObject({ code: "upgrade_unavailable" });
  expect(updates).toHaveLength(count);
  const overview = await store.getLearningOverview(result.buyer.id);
  expect(overview.orders.find(order => order.id === pending.order.id)?.status).toBe("paid");
  expect(overview.subscriptions.filter(item => item.state === "active")).toHaveLength(2);
});

test("upgrade recovery fails closed on provider errors or mismatched Checkout ownership and leaves other users untouched", async () => {
  const result = await upgradeSource();
  const abandoned = await store.createQuote(result.buyer.id, "science-pc-6");
  const pending = await payment.startPayment(result.buyer, { quoteId: abandoned.quote.id, consents: consent }, request());
  const session = sessions.get(pending.order.stripeCheckoutSessionId!)!;
  session.status = "expired";
  const { quote } = await store.createUpgradeQuote(result.buyer.id, result.source.id), count = updates.length;
  const retrieve = stripe.checkout.sessions.retrieve;
  stripe.checkout.sessions.retrieve = (async () => { throw new Error("Stripe unavailable"); }) as typeof retrieve;
  try {
    await expect(payment.startPayment(result.buyer, { quoteId: quote.id, consents: consent }, request())).rejects.toThrow("Stripe unavailable");
  } finally { stripe.checkout.sessions.retrieve = retrieve; }
  const originalUserId = session.metadata!.userId;
  session.metadata!.userId = "another-user";
  await expect(payment.startPayment(result.buyer, { quoteId: quote.id, consents: consent }, request())).rejects.toThrow("Checkout identity mismatch");
  session.metadata!.userId = originalUserId;
  expect(updates).toHaveLength(count);
  expect((await store.getLearningOverview(result.buyer.id)).orders.find(order => order.id === pending.order.id)?.status).toBe("pending");
  const other = await upgradeSource();
  const otherQuote = await store.createUpgradeQuote(other.buyer.id, other.source.id);
  await payment.startPayment(other.buyer, { quoteId: otherQuote.quote.id, consents: consent }, request());
  expect((await store.getLearningOverview(result.buyer.id)).orders.find(order => order.id === pending.order.id)?.status).toBe("pending");
});

test("upgrade checkout API recovers expired Category reservations in both locales and retains open-payment and authentication checks", async () => {
  const state = { user: null as Awaited<ReturnType<typeof user>> | null, payment, paymentFailure };
  (globalThis as any).stripeUpgradeCheckoutApi = state;
  try {
    const route = await purchaseCheckoutRoute();
    for (const locale of ["en-GB", "zh-CN"] as const) {
      const result = await upgradeSource();
      state.user = { ...result.buyer, locale };
      const abandoned = await store.createQuote(result.buyer.id, "science-pc-6");
      const pending = await payment.startPayment(result.buyer, { quoteId: abandoned.quote.id, consents: consent }, request());
      const { quote } = await store.createUpgradeQuote(result.buyer.id, result.source.id), count = updates.length;
      const invoke = (quoteId = quote.id) => route.POST(new Request(request(), { headers: { origin: "https://payment.example.test", "content-type": "application/json" }, body: JSON.stringify({ quoteId, locale, consents: consent }) }));
      expect(await (await invoke()).json()).toMatchObject({ ok: false, code: "upgrade_in_progress" });
      expect(updates).toHaveLength(count);
      sessions.get(pending.order.stripeCheckoutSessionId!)!.status = "expired";
      expect((await invoke()).status).toBe(200);
      expect((await invoke()).status).toBe(200);
      expect(updates).toHaveLength(count + 1);
      state.user = null;
      expect((await invoke()).status).toBe(401);
    }
  } finally { delete (globalThis as any).stripeUpgradeCheckoutApi; }
});

test("a Category with historical renewal orders still previews against its verified original recurring Price", async () => {
  const result = await upgradeSource();
  const renewal = { id: "in_category_before_upgrade", parent: { subscription_details: { subscription: result.subscription.id } }, currency: "usd", amount_paid: result.order.amountMinor, status: "paid", billing_reason: "subscription_cycle", lines: { has_more: false, data: [{ period: { start: result.start, end: result.end }, pricing: { price_details: { price: result.order.price!.stripePriceId } } }] } } as unknown as Stripe.Invoice;
  invoices.set(renewal.id, renewal);
  expect((await send("invoice.paid", "evt_category_before_upgrade", renewal.id)).status).toBe(200);
  const latest = (await store.getLearningOverview(result.buyer.id)).orders[0];
  expect(latest.price).toBeUndefined();
  const { quote } = await store.createUpgradeQuote(result.buyer.id, result.source.id);
  expect(quote.upgradeProration?.sourcePriceId).toBe(result.order.price!.stripePriceId);
  expect((await payment.startPayment(result.buyer, { quoteId: quote.id, consents: consent }, request())).order.status).toBe("paid");
});

test("a legacy paid Stripe Category without a Price snapshot or app marker upgrades using its verified original Checkout", async () => {
  const result = await upgradeSource();
  delete result.session.metadata!.app;
  delete result.subscription.metadata.app;
  const file = path.join(directory, "data/knowledge_system/learning_guide/product.json");
  const data = JSON.parse(await readFile(file, "utf8"));
  delete data.orders.find((item: { id: string }) => item.id === result.order.id).price;
  // Legacy fulfilment used local callback time instead of Stripe period bounds.
  const oldSource = data.subscriptions.find((item: { id: string }) => item.id === result.source.id);
  oldSource.validFrom = new Date((result.start + 4) * 1000).toISOString();
  oldSource.validTo = new Date((result.end + 4) * 1000).toISOString();
  await writeFile(file, JSON.stringify(data));
  const original = JSON.parse(await readFile(file, "utf8"));
  const count = updates.length;
  const { quote } = await store.createUpgradeQuote(result.buyer.id, result.source.id);
  expect(quote.upgradeProration).toMatchObject({ sourcePriceId: result.order.price!.stripePriceId, periodEnd: result.end, amountDueMinor: 3586 });
  expect(updates).toHaveLength(count);
  await hydrateQuoteWithJsonbKeyOrder(quote.id);
  const afterQuote = JSON.parse(await readFile(file, "utf8"));
  expect(afterQuote.orders).toEqual(original.orders);
  expect(afterQuote.subscriptions).toEqual(original.subscriptions);
  const changed = structuredClone(afterQuote);
  changed.subscriptions.find((item: { id: string }) => item.id === result.source.id).validTo = new Date((result.end + 5) * 1000).toISOString();
  await writeFile(file, JSON.stringify(changed));
  await expect(payment.startPayment(result.buyer, { quoteId: quote.id, consents: consent }, request())).rejects.toMatchObject({ code: "quote_expired" });
  expect(updates).toHaveLength(count);
  await writeFile(file, JSON.stringify(afterQuote));
  let upgrade: Awaited<ReturnType<typeof payment.startPayment>>;
  upgradePaymentPending = true;
  try { upgrade = await payment.startPayment(result.buyer, { quoteId: quote.id, consents: consent }, request()); }
  finally { upgradePaymentPending = false; }
  const invoice = invoices.get(upgrade.order.stripeInvoiceId!)!;
  invoice.status = "paid"; invoice.amount_paid = invoice.amount_due;
  result.subscription.pending_update = null;
  result.subscription.items.data[0].price = catalog.get("everything-pc-6")!;
  expect((await send("invoice.paid", "evt_legacy_native_upgrade", invoice.id)).status).toBe(200);
  expect((await send("invoice.paid", "evt_legacy_native_upgrade", invoice.id)).status).toBe(200);
  expect((await store.getLearningOverview(result.buyer.id)).subscriptions.find(item => item.scope === "everything")?.validTo).toBe(new Date(result.end * 1000).toISOString());
});

test("cancelled renewal during a pending upgrade is preserved after payment, with the original end date", async () => {
  const result = await upgradeSource(), { quote } = await store.createUpgradeQuote(result.buyer.id, result.source.id);
  upgradePaymentPending = true;
  let upgraded: Awaited<ReturnType<typeof payment.startPayment>>;
  try { upgraded = await payment.startPayment(result.buyer, { quoteId: quote.id, consents: consent }, request()); } finally { upgradePaymentPending = false; }
  result.subscription.cancel_at_period_end = true;
  expect((await send("customer.subscription.updated", "evt_pending_cancel_renewal", result.subscription.id)).status).toBe(200);
  expect((await payment.startPayment(result.buyer, { quoteId: quote.id, consents: consent }, request())).checkoutUrl).toBe(upgraded.checkoutUrl);
  const invoice = invoices.get(upgraded.order.stripeInvoiceId!)!;
  invoice.status = "paid"; invoice.amount_paid = invoice.amount_due;
  result.subscription.pending_update = null; result.subscription.items.data[0].price = catalog.get("everything-pc-6")!;
  expect((await send("invoice.paid", "evt_paid_after_renewal_cancel", invoice.id)).status).toBe(200);
  const everything = (await store.getLearningOverview(result.buyer.id)).subscriptions.find(item => item.scope === "everything");
  expect(everything).toMatchObject({ state: "cancel_at_period_end", cancelAtPeriodEnd: true, validTo: result.source.validTo });
});

test("lost Stripe update response is recovered through its invoice without charging again", async () => {
  const result = await upgradeSource(), { quote } = await store.createUpgradeQuote(result.buyer.id, result.source.id);
  loseUpgradeResponse = true;
  await expect(payment.startPayment(result.buyer, { quoteId: quote.id, consents: consent }, request())).rejects.toThrow("response lost");
  const file = path.join(directory, "data/knowledge_system/learning_guide/product.json");
  const data = JSON.parse(await readFile(file, "utf8"));
  data.quotes.find((item: { id: string }) => item.id === quote.id).expiresAt = "2000-01-01T00:00:00Z";
  await writeFile(file, JSON.stringify(data));
  const count = updates.length;
  const recovered = await payment.startPayment(result.buyer, { quoteId: quote.id, consents: consent }, request());
  expect(recovered.order.status).toBe("paid"); expect(updates).toHaveLength(count);
  expect((await store.getLearningOverview(result.buyer.id)).subscriptions.filter(item => item.state === "active")[0].scope).toBe("everything");
});

test("a signed invoice arriving before the update response associates and fulfils the reserved order once", async () => {
  const result = await upgradeSource(), { quote } = await store.createUpgradeQuote(result.buyer.id, result.source.id);
  webhookBeforeUpgradeResponse = true;
  const upgraded = await payment.startPayment(result.buyer, { quoteId: quote.id, consents: consent }, request());
  const overview = await store.getLearningOverview(result.buyer.id);
  expect(upgraded.order.status).toBe("paid");
  expect(overview.orders.filter(item => item.kind === "upgrade")).toHaveLength(1);
  expect(overview.subscriptions.filter(item => item.scope === "everything")).toHaveLength(1);
});

test("an invoice with a wrong amount or customer never grants Everything and can be retried after correction", async () => {
  const result = await upgradeSource(), { quote } = await store.createUpgradeQuote(result.buyer.id, result.source.id);
  upgradePaymentPending = true;
  let upgraded: Awaited<ReturnType<typeof payment.startPayment>>;
  try { upgraded = await payment.startPayment(result.buyer, { quoteId: quote.id, consents: consent }, request()); } finally { upgradePaymentPending = false; }
  const invoice = invoices.get(upgraded.order.stripeInvoiceId!)!;
  result.subscription.pending_update = null; result.subscription.items.data[0].price = catalog.get("everything-pc-6")!;
  invoice.status = "paid"; invoice.amount_paid = invoice.amount_due; invoice.amount_due = 1;
  expect((await send("invoice.paid", "evt_upgrade_mismatch", invoice.id)).status).toBe(400);
  invoice.amount_due = quote.amountMinor; const customer = invoice.customer; invoice.customer = "cus_wrong";
  expect((await send("invoice.paid", "evt_upgrade_mismatch", invoice.id)).status).toBe(400);
  expect((await store.getLearningOverview(result.buyer.id)).subscriptions.filter(item => item.scope === "everything")).toHaveLength(0);
  invoice.customer = customer;
  expect((await send("invoice.paid", "evt_upgrade_mismatch", invoice.id)).status).toBe(200);
});

test("Stripe preview failure and an expired quote cannot fall back to a fixed fee or create a charge", async () => {
  const result = await upgradeSource(), before = updates.length;
  const preview = stripe.invoices.createPreview;
  stripe.invoices.createPreview = (async () => { throw new Error("Stripe unavailable"); }) as typeof preview;
  try { await expect(store.createUpgradeQuote(result.buyer.id, result.source.id)).rejects.toMatchObject({ code: "price_unavailable" }); } finally { stripe.invoices.createPreview = preview; }
  const { quote } = await store.createUpgradeQuote(result.buyer.id, result.source.id);
  const file = path.join(directory, "data/knowledge_system/learning_guide/product.json"), data = JSON.parse(await readFile(file, "utf8"));
  data.quotes.find((item: { id: string }) => item.id === quote.id).expiresAt = "2000-01-01T00:00:00Z";
  await writeFile(file, JSON.stringify(data));
  await expect(payment.startPayment(result.buyer, { quoteId: quote.id, consents: consent }, request())).rejects.toMatchObject({ code: "quote_expired" });
  expect(updates).toHaveLength(before);
  expect((await store.getLearningOverview(result.buyer.id)).orders).toHaveLength(1);
});

test("changed Stripe amount, invalid source interval and another user's quote fail before update", async () => {
  const result = await upgradeSource(), { quote } = await store.createUpgradeQuote(result.buyer.id, result.source.id);
  const count = updates.length;
  await expect(payment.startPayment(await user(), { quoteId: quote.id, consents: consent }, request())).rejects.toMatchObject({ code: "quote_expired" });
  upgradePreviewAmount = 1467;
  try { await expect(payment.startPayment(result.buyer, { quoteId: quote.id, consents: consent }, request())).rejects.toMatchObject({ code: "quote_expired" }); } finally { upgradePreviewAmount = 3586; }
  const sourcePrice = result.subscription.items.data[0].price;
  result.subscription.items.data[0].price = { ...sourcePrice, recurring: { ...sourcePrice.recurring!, interval_count: 1 } };
  await expect(store.createUpgradeQuote(result.buyer.id, result.source.id)).rejects.toMatchObject({ code: "upgrade_unavailable" });
  result.subscription.items.data[0].price = sourcePrice;
  result.subscription.items.data[0].current_period_end += 86400;
  await expect(store.createUpgradeQuote(result.buyer.id, result.source.id)).rejects.toMatchObject({ code: "upgrade_unavailable" });
  expect(updates).toHaveLength(count);
});

test("zero Stripe amount is honoured and old fixed upgrade price configuration is unnecessary", async () => {
  const result = await upgradeSource();
  const saved = process.env.STRIPE_PRICE_UPGRADE_SIX_MONTHS;
  delete process.env.STRIPE_PRICE_UPGRADE_SIX_MONTHS; upgradePreviewAmount = 0;
  try {
    const { quote } = await store.createUpgradeQuote(result.buyer.id, result.source.id);
    expect(quote.amountMinor).toBe(0);
    const upgraded = await payment.startPayment(result.buyer, { quoteId: quote.id, consents: consent }, request());
    expect(upgraded.order.status).toBe("paid");
  } finally { process.env.STRIPE_PRICE_UPGRADE_SIX_MONTHS = saved; upgradePreviewAmount = 3586; }
});

test("quote API returns Stripe's amount for the session owner and ignores client amount, Price and term", async () => {
  const result = await upgradeSource(12);
  const state = { user: result.buyer as typeof result.buyer | null, store, paymentFailure };
  (globalThis as any).stripeUpgradeApi = state;
  try {
    const bundle = await build({ entryPoints: [path.join(cwd, "app/api/subscription/quote/route.ts")], bundle: true, write: false, platform: "node", format: "cjs", external: ["next/server"], plugins: [{ name: "session", setup(b) {
      b.onResolve({ filter: /services\/(productStore|productAuth|paymentHttp)$/ }, args => ({ path: args.path, namespace: "mock" }));
      b.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents: args.path.endsWith("productAuth") ? "export async function currentProductUser(){return globalThis.stripeUpgradeApi.user}" : args.path.endsWith("paymentHttp") ? "export const paymentFailure=(...args)=>globalThis.stripeUpgradeApi.paymentFailure(...args)" : "export const createQuote=(...args)=>globalThis.stripeUpgradeApi.store.createQuote(...args),createUpgradeQuote=(...args)=>globalThis.stripeUpgradeApi.store.createUpgradeQuote(...args),getQuoteForUser=(...args)=>globalThis.stripeUpgradeApi.store.getQuoteForUser(...args)" }));
    } }] });
    const routeModule = { exports: {} as { POST: (request: Request) => Promise<Response>; GET: (request: Request) => Promise<Response> } };
    new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(path.join(cwd, "package.json")), routeModule, routeModule.exports);
    const invoke = () => routeModule.exports.POST(new Request("https://payment.example.test/api/subscription/quote", { method: "POST", body: JSON.stringify({ kind: "upgrade", subscriptionId: result.source.id, amountMinor: 1, priceId: "untrusted", termMonths: 6, userId: "forged" }) }));
    const response = await invoke(); expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.quote).toMatchObject({ userId: result.buyer.id, amountMinor: 3586, creditMinor: 1200, price: { termMonths: 12, stripePriceId: "price_everything-pc-12" }, upgradeProration: { subscriptionId: result.subscription.id, periodEnd: result.end } });
    expect(body.plan.amountMinor).toBe(19800);
    const file = path.join(directory, "data/knowledge_system/learning_guide/product.json"), data = JSON.parse(await readFile(file, "utf8"));
    delete data.orders.find((item: { id: string }) => item.id === result.order.id).price;
    await writeFile(file, JSON.stringify(data));
    delete result.session.metadata!.app;
    delete result.subscription.metadata.app;
    const legacy = await invoke();
    expect(legacy.status).toBe(200);
    expect((await legacy.json()).quote.upgradeProration).toMatchObject({ sourcePriceId: result.order.price!.stripePriceId, periodEnd: result.end, amountDueMinor: 3586 });
    state.user = await user();
    expect((await routeModule.exports.GET(new Request(`https://payment.example.test/api/subscription/quote?quoteId=${body.quote.id}`))).status).toBe(404);
    state.user = null; expect((await invoke()).status).toBe(401);
  } finally { delete (globalThis as any).stripeUpgradeApi; }
});

test("new fixed-fee checkouts are rejected while already-issued legacy Checkout callbacks still reconcile", async () => {
  const result = await upgradeSource(), { quote } = await store.createUpgradeQuote(result.buyer.id, result.source.id);
  const file = path.join(directory, "data/knowledge_system/learning_guide/product.json"), data = JSON.parse(await readFile(file, "utf8"));
  const oldQuote = data.quotes.find((item: { id: string }) => item.id === quote.id);
  delete oldQuote.upgradeProration;
  Object.assign(oldQuote, { amountMinor: 6000, creditMinor: 3900, upgradePrice: { stripePriceId: "price_lg_upgrade_60", lookupKey: "lg_upgrade_60", amountMinor: 6000, currency: "usd", termMonths: 6 } });
  await writeFile(file, JSON.stringify(data));
  await expect(payment.startPayment(result.buyer, { quoteId: quote.id, consents: consent }, request())).rejects.toMatchObject({ code: "quote_expired" });
  const { order } = await store.createPendingStripeUpgradeOrderFromQuote(result.buyer.id, quote.id), sessionId = "cs_legacy_upgrade";
  await store.attachStripeCheckoutSession(result.buyer.id, order.id, sessionId);
  sessions.set(sessionId, { id: sessionId, mode: "payment", status: "complete", payment_status: "paid", currency: "usd", amount_total: 6000, metadata: { app: "learning_guide", orderId: order.id, userId: result.buyer.id, quoteId: quote.id, planId: "everything-pc-6" }, line_items: { has_more: false, data: [{ quantity: 1, price: { id: "price_lg_upgrade_60" } }] } } as unknown as Stripe.Checkout.Session);
  expect((await send("checkout.session.completed", "evt_legacy_upgrade_paid", sessionId)).status).toBe(200);
  expect((await send("checkout.session.completed", "evt_legacy_upgrade_paid", sessionId)).status).toBe(200);
  expect((await store.getLearningOverview(result.buyer.id)).subscriptions.find(item => item.scope === "everything")?.validTo).toBe(result.source.validTo);
});

test("upgrade Price rejects missing configuration, recurring products, wrong amounts and inactive Prices",async()=>{
  const saved=process.env.STRIPE_PRICE_UPGRADE_SIX_MONTHS;
  delete process.env.STRIPE_PRICE_UPGRADE_SIX_MONTHS;
  await expect(prices.resolveUpgradePrice(6)).rejects.toMatchObject({code:"price_unavailable"});
  process.env.STRIPE_PRICE_UPGRADE_SIX_MONTHS=saved;
  const valid=catalog.get("lg_upgrade_60")!;
  for(const patch of [{active:false},{unit_amount:6100},{currency:"gbp"},{type:"recurring",recurring:{interval:"month",interval_count:6}}]) {
    catalog.set("lg_upgrade_60",{...valid,...patch} as Stripe.Price);
    await expect(prices.resolveUpgradePrice(6)).rejects.toMatchObject({code:"price_unavailable"});
  }
  catalog.set("lg_upgrade_60",valid);
});


function recoverySession(result: Awaited<ReturnType<typeof checkout>>) {
  const session = sessions.get(result.order.stripeCheckoutSessionId!)!;
  Object.assign(session, { amount_total: result.order.amountMinor, expires_at: Math.floor(Date.now() / 1000) + 3600,
    url: "https://checkout.stripe.com/c/pay/" + session.id,
    line_items: { has_more: false, data: [{ quantity: 1, price: { id: result.order.price!.stripePriceId } }] } });
  return session;
}
async function pendingUpgradeForRecovery() {
  const result = await upgradeSource(), { quote } = await store.createUpgradeQuote(result.buyer.id, result.source.id);
  upgradePaymentPending = true;
  try {
    const upgraded = await payment.startPayment(result.buyer, { quoteId: quote.id, consents: consent }, request());
    const invoice = invoices.get(upgraded.order.stripeInvoiceId!)!;
    invoice.hosted_invoice_url = "https://invoice.stripe.com/i/" + invoice.id;
    return { ...result, upgraded, invoice, upgradeQuote: quote };
  } finally { upgradePaymentPending = false; }
}

test("order recovery lists orphan pending orders privately and resumes their original Checkout after Quote expiry", async () => {
  const result = await checkout("science-pc-6"), session = recoverySession(result);
  const file = path.join(directory, "data/knowledge_system/learning_guide/product.json"), data = JSON.parse(await readFile(file, "utf8"));
  data.quotes.find((item: { id: string }) => item.id === result.quote.id).expiresAt = "2000-01-01T00:00:00Z";
  await writeFile(file, JSON.stringify(data));
  expect(await orderPayments.listManagedOrders((await user()).id)).toEqual([]);
  const rows = await orderPayments.listManagedOrders(result.buyer.id);
  expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ id: result.order.id, state: "unverified", status: "pending", canResume: false });
  expect(JSON.stringify(rows)).not.toContain(session.id); expect(JSON.stringify(rows)).not.toContain(result.buyer.id);
  const count = requests.length;
  const checked = await orderPayments.manageOrderPayment(result.buyer.id, result.order.id, "check");
  expect(checked.order).toMatchObject({ state: "awaiting_payment", canResume: true, canCancel: true, amountMinor: 3900 });
  expect(checked.checkoutUrl).toBeUndefined();
  expect((await orderPayments.manageOrderPayment(result.buyer.id, result.order.id, "resume")).checkoutUrl).toBe(session.url);
  expect(requests).toHaveLength(count);
});

test("order cancellation closes the provider Checkout once, keeps history and allows a new purchase", async () => {
  const result = await checkout("science-pc-6"); recoverySession(result);
  const expire = stripe.checkout.sessions.expire;
  stripe.checkout.sessions.expire = (async () => { throw new Error("temporary cancellation failure"); }) as typeof expire;
  try { expect((await orderPayments.manageOrderPayment(result.buyer.id, result.order.id, "cancel")).order.status).toBe("pending"); }
  finally { stripe.checkout.sessions.expire = expire; }
  expect((await store.listOperatorOrders({ search: result.order.id }))[0].activities.find(item => item.action === "cancel_payment")).toMatchObject({ result: "failed", reason: "payment_still_open" });
  const second = await store.createQuote(result.buyer.id, "science-pc-12");
  await expect(payment.startPayment(result.buyer, { quoteId: second.quote.id, consents: consent }, request())).rejects.toMatchObject({ code: "payment_pending", blockingOrderId: result.order.id });
  const outcomes = await Promise.all([orderPayments.manageOrderPayment(result.buyer.id, result.order.id, "cancel"), orderPayments.manageOrderPayment(result.buyer.id, result.order.id, "cancel")]);
  expect(outcomes.every(item => item.order.status === "canceled")).toBe(true);
  expect((await orderPayments.manageOrderPayment(result.buyer.id, result.order.id, "cancel")).order.state).toBe("canceled");
  expect((await store.getLearningOverview(result.buyer.id)).subscriptions).toHaveLength(0);
  expect((await orderPayments.listManagedOrders(result.buyer.id))).toHaveLength(1);
  expect((await payment.startPayment(result.buyer, { quoteId: second.quote.id, consents: consent }, request())).order.status).toBe("pending");
});

test("order recovery fulfils a paid Checkout with missing Webhook once and a late duplicate cannot duplicate access", async () => {
  const result = await checkout("science-pc-6"); recoverySession(result); const { session } = paidSession(result.order);
  const rows = await Promise.all([orderPayments.manageOrderPayment(result.buyer.id, result.order.id, "check"), orderPayments.manageOrderPayment(result.buyer.id, result.order.id, "cancel")]);
  expect(rows.every(row => row.order.status === "paid" && !row.checkoutUrl)).toBe(true);
  expect((await send("checkout.session.completed", "evt_recovery_late", session.id)).status).toBe(200);
  expect((await send("checkout.session.completed", "evt_recovery_late", session.id)).status).toBe(200);
  const overview = await store.getLearningOverview(result.buyer.id);
  expect(overview.subscriptions).toHaveLength(1); expect(overview.entitlements).toHaveLength(1);
});

test("order cancel versus Checkout payment race returns paid and never cancels existing access", async () => {
  const result = await checkout("science-pc-6"); recoverySession(result);
  const original = stripe.checkout.sessions.expire;
  stripe.checkout.sessions.expire = (async () => { paidSession(result.order); throw new Error("Checkout already complete"); }) as typeof original;
  try { expect((await orderPayments.manageOrderPayment(result.buyer.id, result.order.id, "cancel")).order.status).toBe("paid"); }
  finally { stripe.checkout.sessions.expire = original; }
  expect((await store.getLearningOverview(result.buyer.id)).subscriptions).toHaveLength(1);
  expect((await store.listOperatorOrders({ search: result.order.id }))[0].activities.find(item => item.action === "cancel_payment")).toMatchObject({ result: "failed", reason: "payment_already_completed" });
});

test("processing, unverifiable and foreign orders retain reservations and never return payment URLs or cancel", async () => {
  const result = await checkout("science-pc-6"), session = recoverySession(result);
  await expect(orderPayments.manageOrderPayment((await user()).id, result.order.id, "cancel")).rejects.toMatchObject({ code: "not_found" });
  const original = stripe.checkout.sessions.retrieve;
  stripe.checkout.sessions.retrieve = (async () => { throw new Error("Provider offline"); }) as typeof original;
  try { expect((await orderPayments.manageOrderPayment(result.buyer.id, result.order.id, "cancel")).order).toMatchObject({ status: "pending", state: "unavailable", reason: "provider_unavailable" }); }
  finally { stripe.checkout.sessions.retrieve = original; }
  session.metadata!.userId = "foreign";
  expect((await orderPayments.manageOrderPayment(result.buyer.id, result.order.id, "cancel")).order).toMatchObject({ status: "pending", reason: "identity_mismatch", canCancel: false });
  session.metadata!.userId = result.buyer.id;
  const goodUrl = session.url; session.url = "https://evil.example/checkout";
  expect((await orderPayments.manageOrderPayment(result.buyer.id, result.order.id, "resume")).checkoutUrl).toBeUndefined();
  session.url = goodUrl;
  session.status = "complete"; session.payment_status = "unpaid";
  expect((await orderPayments.manageOrderPayment(result.buyer.id, result.order.id, "cancel")).order).toMatchObject({ status: "pending", state: "processing", canCancel: false });
  expect(session.status).toBe("complete");
});

test("paid but temporarily unavailable fulfilment is shown as synchronising and can recover without another payment", async () => {
  const result = await checkout("science-pc-6"); recoverySession(result); const remote = paidSession(result.order);
  const original = stripe.subscriptions.retrieve;
  // Checkout expands the subscription in this fixture; remove it to exercise provider failure during fulfilment.
  remote.session.subscription = remote.subscription.id;
  stripe.subscriptions.retrieve = (async () => { throw new Error("temporarily unavailable"); }) as typeof original;
  try { expect((await orderPayments.manageOrderPayment(result.buyer.id, result.order.id, "check")).order).toMatchObject({ state: "synchronising", reason: "fulfilment_pending", canResume: false }); }
  finally { stripe.subscriptions.retrieve = original; }
  expect((await orderPayments.manageOrderPayment(result.buyer.id, result.order.id, "check")).order.status).toBe("paid");
});

test("upgrade recovery resumes the pinned invoice and cancellation retains Category dates and renewal settings", async () => {
  const result = await pendingUpgradeForRecovery(), count = updates.length;
  const before = (await store.getLearningOverview(result.buyer.id)).subscriptions.find(item => item.id === result.source.id)!;
  expect((await orderPayments.manageOrderPayment(result.buyer.id, result.upgraded.order.id, "resume")).checkoutUrl).toBe(result.invoice.hosted_invoice_url);
  const canceled = await orderPayments.manageOrderPayment(result.buyer.id, result.upgraded.order.id, "cancel");
  expect(canceled.order.status).toBe("canceled"); expect(result.invoice.status).toBe("void");
  expect(result.subscription.pending_update).toBeNull(); expect(updates).toHaveLength(count);
  const overview = await store.getLearningOverview(result.buyer.id);
  expect(overview.subscriptions.find(item => item.id === result.source.id)).toEqual(before);
  expect(overview.subscriptions.some(item => item.scope === "everything")).toBe(false);
  const retry = await store.createUpgradeQuote(result.buyer.id, result.source.id);
  expect(retry.quote.upgradeProration?.sourceVoidedUpgradeInvoiceId).toBe(result.invoice.id);
  upgradePaymentPending = true;
  try { expect((await payment.startPayment(result.buyer, { quoteId: retry.quote.id, consents: consent }, request())).order.status).toBe("pending"); }
  finally { upgradePaymentPending = false; }
});

test("upgrade cancellation racing payment fulfils Everything once and wrong invoice ownership never voids", async () => {
  const result = await pendingUpgradeForRecovery();
  const customer = result.invoice.customer; result.invoice.customer = "foreign";
  expect((await orderPayments.manageOrderPayment(result.buyer.id, result.upgraded.order.id, "cancel")).order.status).toBe("pending");
  expect(result.invoice.status).toBe("open"); result.invoice.customer = customer;
  const original = stripe.invoices.voidInvoice;
  stripe.invoices.voidInvoice = (async () => {
    result.invoice.status = "paid"; result.invoice.amount_paid = result.invoice.amount_due;
    result.subscription.pending_update = null; result.subscription.items.data[0].price = catalog.get("everything-pc-6")!;
    throw new Error("Invoice already paid");
  }) as typeof original;
  try { expect((await orderPayments.manageOrderPayment(result.buyer.id, result.upgraded.order.id, "cancel")).order.status).toBe("paid"); }
  finally { stripe.invoices.voidInvoice = original; }
  expect((await store.getLearningOverview(result.buyer.id)).subscriptions.filter(item => item.state === "active")).toHaveLength(1);
});

test("order recovery refuses to release a void upgrade until its pending update is removed and records operator attribution", async () => {
  const result = await pendingUpgradeForRecovery(); result.invoice.status = "void";
  expect((await orderPayments.manageOrderPayment(result.buyer.id, result.upgraded.order.id, "check")).order.status).toBe("pending");
  result.subscription.pending_update = null;
  expect((await orderPayments.manageOrderPayment(result.buyer.id, result.upgraded.order.id, "check")).order.status).toBe("canceled");
  const pending = await checkout("science-pc-6"); recoverySession(pending);
  await actOnOperatorOrder({ ...pending.buyer, role: "operator" }, { orderId: pending.order.id, action: "resynchronise" });
  const row = (await store.listOperatorOrders({ search: pending.order.id }))[0];
  expect(row.activities.some(item => item.actorRole === "operator" && item.action === "check_payment")).toBe(true);
  expect(row.lastSyncedAt).toBeTruthy();
  await expect(actOnOperatorOrder(pending.buyer, { orderId: pending.order.id, action: "cancel" })).rejects.toMatchObject({ code: "forbidden" });
  const canceled = await actOnOperatorOrder({ ...pending.buyer, role: "operator" }, { orderId: pending.order.id, action: "cancel" });
  expect(canceled.order?.status).toBe("canceled");
  expect((await store.listOperatorOrders({ search: pending.order.id }))[0].activities.some(item => item.action === "cancel_payment" && item.actorRole === "operator")).toBe(true);
});

async function recoveryRoutes(state: { user: Awaited<ReturnType<typeof user>> | null }) {
  (globalThis as any).orderRecoveryApi = { state, service: orderPayments, contract: orderContract, http: orderHttp, payment };
  const entries = ["app/api/my-learning/orders/route.ts", "app/api/my-learning/orders/[orderId]/route.ts"];
  const routes = [];
  for (const entry of entries) {
    const bundle = await build({ entryPoints: [path.join(cwd, entry)], bundle: true, write: false, platform: "node", format: "cjs", external: ["next/server"], plugins: [{ name: "account-and-services", setup(b) {
      b.onResolve({ filter: /(?:services\/(?:productAuth|orderPaymentService|orderManagementHttp|paymentService)|contracts\/order-management)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      b.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents:
        args.path.endsWith("productAuth") ? "export async function currentProductUser(){return globalThis.orderRecoveryApi.state.user}" :
        args.path.endsWith("orderPaymentService") ? "export const listManagedOrders=(...a)=>globalThis.orderRecoveryApi.service.listManagedOrders(...a),manageOrderPayment=(...a)=>globalThis.orderRecoveryApi.service.manageOrderPayment(...a)" :
        args.path.endsWith("orderManagementHttp") ? "export const orderManagementResponse=(...a)=>globalThis.orderRecoveryApi.http.orderManagementResponse(...a),orderManagementFailure=(...a)=>globalThis.orderRecoveryApi.http.orderManagementFailure(...a)" :
        args.path.endsWith("order-management") ? "export const OrderManagementError=globalThis.orderRecoveryApi.contract.OrderManagementError,parseOrderAction=globalThis.orderRecoveryApi.contract.parseOrderAction" :
        "export const checkoutRequestOrigin=(...a)=>globalThis.orderRecoveryApi.payment.checkoutRequestOrigin(...a)" }));
    } }] });
    const routeModule = { exports: {} as { GET: (request: Request) => Promise<Response>; POST: (request: Request, context: { params: Promise<{ orderId: string }> }) => Promise<Response> } };
    new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(path.join(cwd, "package.json")), routeModule, routeModule.exports);
    routes.push(routeModule.exports);
  }
  return routes;
}

test("account order APIs cover list/check/resume/cancel in both locales with private caching, unauthenticated, foreign and malformed requests", async () => {
  const state = { user: null as Awaited<ReturnType<typeof user>> | null };
  try {
    const [list, actions] = await recoveryRoutes(state);
    for (const locale of ["en-GB", "zh-CN"] as const) {
      const result = await checkout("science-pc-6"), session = recoverySession(result);
      const url = `https://payment.example.test/api/my-learning/orders/${result.order.id}?locale=${locale}`;
      const invoke = (body: unknown, origin = "https://payment.example.test", id = result.order.id) => actions.POST(new Request(url, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ orderId: id }) });
      expect((await invoke({ action: "cancel" })).status).toBe(401);
      expect((await list.GET(new Request(url))).status).toBe(401);
      state.user = { ...result.buyer, locale };
      expect((await invoke({ action: "cancel" }, "https://evil.example")).status).toBe(403);
      for (const invalid of [null, [], {}, { action: "pay" }, { action: { toString: "cancel" } }, { action: "cancel", userId: result.buyer.id }]) expect((await invoke(invalid)).status).toBe(400);
      expect((await invoke({ action: "check" }, undefined, "../bad")).status).toBe(400);
      const listed = await list.GET(new Request(url)); expect(listed.headers.get("Cache-Control")).toContain("no-store"); expect(listed.headers.get("Vary")).toContain("Cookie");
      expect((await listed.json()).data.orders).toHaveLength(1);
      const checked = await invoke({ action: "check" }); expect(checked.status).toBe(200); expect((await checked.json()).data.order.canResume).toBe(true);
      expect((await (await invoke({ action: "resume" })).json()).data.checkoutUrl).toBe(session.url);
      state.user = await user(); expect((await invoke({ action: "cancel" })).status).toBe(404); expect(session.status).toBe("open");
      state.user = result.buyer; expect((await (await invoke({ action: "cancel" })).json()).data.order.status).toBe("canceled");
      expect((await invoke({ action: "cancel" })).status).toBe(200);
      state.user = null;
    }
  } finally { delete (globalThis as any).orderRecoveryApi; }
});


test("natural Checkout expiry and missing payment references remain distinct from an explicit cancellation", async () => {
  const result = await checkout("science-pc-6"), session = recoverySession(result);
  session.status = "expired";
  expect((await orderPayments.manageOrderPayment(result.buyer.id, result.order.id, "check")).order).toMatchObject({ state: "expired", status: "canceled" });
  const buyer = await user(), { quote } = await store.createQuote(buyer.id, "science-pc-6");
  const { order } = await store.createPendingStripeOrder(buyer.id, quote.id);
  const outcome = await orderPayments.manageOrderPayment(buyer.id, order.id, "cancel");
  expect(outcome.order).toMatchObject({ status: "pending", state: "unavailable", reason: "missing_payment", canCancel: false });
  expect((await store.getOrderForUser(buyer.id, order.id))?.status).toBe("pending");
});

test("order recovery attaches a lost-response upgrade invoice without creating another update", async () => {
  const result = await upgradeSource(), { quote } = await store.createUpgradeQuote(result.buyer.id, result.source.id);
  upgradePaymentPending = true; loseUpgradeResponse = true;
  try { await expect(payment.startPayment(result.buyer, { quoteId: quote.id, consents: consent }, request())).rejects.toThrow(/response lost/); }
  finally { upgradePaymentPending = false; loseUpgradeResponse = false; }
  const pending = (await store.getLearningOverview(result.buyer.id)).orders.find(item => item.quoteId === quote.id)!;
  expect(pending.stripeInvoiceId).toBeFalsy();
  const count = updates.length;
  expect((await orderPayments.manageOrderPayment(result.buyer.id, pending.id, "check")).order).toMatchObject({ status: "pending", state: "awaiting_payment" });
  expect((await store.getOrderForUser(result.buyer.id, pending.id))?.stripeInvoiceId).toBeTruthy();
  expect(updates).toHaveLength(count);
});

test("pending-update Webhooks finish a delayed paid upgrade and an expired update closes its order without granting access", async () => {
  const result = await pendingUpgradeForRecovery();
  result.invoice.status = "paid"; result.invoice.amount_paid = result.invoice.amount_due;
  expect((await orderPayments.manageOrderPayment(result.buyer.id, result.upgraded.order.id, "check")).order.state).toBe("synchronising");
  result.subscription.pending_update = null; result.subscription.items.data[0].price = catalog.get("everything-pc-6")!;
  expect((await send("customer.subscription.pending_update_applied", "evt_order_pending_applied", result.subscription.id)).status).toBe(200);
  expect((await send("customer.subscription.pending_update_applied", "evt_order_pending_applied", result.subscription.id)).status).toBe(200);
  expect((await store.getOrderForUser(result.buyer.id, result.upgraded.order.id))?.status).toBe("paid");
  const expired = await pendingUpgradeForRecovery();
  expired.invoice.status = "void"; expired.subscription.pending_update = null;
  expect((await send("customer.subscription.pending_update_expired", "evt_order_pending_expired", expired.subscription.id)).status).toBe(200);
  expect((await store.getOrderForUser(expired.buyer.id, expired.upgraded.order.id))?.status).toBe("canceled");
  expect((await store.getLearningOverview(expired.buyer.id)).subscriptions.filter(item => item.state === "active").map(item => item.scope)).toEqual(["category"]);
});

test("canceling an upgrade after local access expiry cannot restore expired Entitlements or enable another upgrade", async () => {
  const result = await pendingUpgradeForRecovery();
  const file = path.join(directory, "data/knowledge_system/learning_guide/product.json"), data = JSON.parse(await readFile(file, "utf8"));
  data.subscriptions.filter((item: { userId: string }) => item.userId === result.buyer.id).forEach((item: { state: string; validTo: string }) => { item.state = "expired"; item.validTo = "2000-01-01T00:00:00Z"; });
  data.entitlements.filter((item: { userId: string }) => item.userId === result.buyer.id).forEach((item: { state: string; validTo: string }) => { item.state = "expired"; item.validTo = "2000-01-01T00:00:00Z"; });
  await writeFile(file, JSON.stringify(data));
  expect((await orderPayments.manageOrderPayment(result.buyer.id, result.upgraded.order.id, "cancel")).order.status).toBe("canceled");
  const overview = await store.getLearningOverview(result.buyer.id);
  expect(overview.entitlements).toHaveLength(0); expect(overview.subscriptions.every(item => item.state === "expired")).toBe(true);
  await expect(store.createUpgradeQuote(result.buyer.id, result.source.id)).rejects.toThrow();
});


test("Checkout and upgrade payment intents processing during cancellation retain their reservations", async () => {
  const result = await checkout("science-pc-6"), session = recoverySession(result);
  session.payment_intent = { id: "pi_processing_checkout", status: "processing" } as Stripe.PaymentIntent;
  expect((await orderPayments.manageOrderPayment(result.buyer.id, result.order.id, "cancel")).order).toMatchObject({ state: "processing", status: "pending", canCancel: false, canResume: false });
  session.payment_intent = null;
  const expire = stripe.checkout.sessions.expire;
  stripe.checkout.sessions.expire = (async () => { session.status = "complete"; session.payment_status = "unpaid"; throw new Error("processing began"); }) as typeof expire;
  try { expect((await orderPayments.manageOrderPayment(result.buyer.id, result.order.id, "cancel")).order).toMatchObject({ state: "processing", status: "pending", canResume: false }); }
  finally { stripe.checkout.sessions.expire = expire; }
  const upgrade = await pendingUpgradeForRecovery();
  const list = stripe.invoicePayments.list, retrieve = stripe.paymentIntents.retrieve, voidInvoice = stripe.invoices.voidInvoice;
  let processing = false, voidCalls = 0;
  stripe.invoicePayments.list = (async () => ({ has_more: false, data: [{ status: "open", payment: { payment_intent: "pi_processing_upgrade" } }] })) as unknown as typeof list;
  stripe.paymentIntents.retrieve = (async () => ({ id: "pi_processing_upgrade", status: processing ? "processing" : "requires_action" })) as unknown as typeof retrieve;
  stripe.invoices.voidInvoice = (async () => { voidCalls++; processing = true; throw new Error("payment processing began"); }) as typeof voidInvoice;
  try {
    const canceled = await orderPayments.manageOrderPayment(upgrade.buyer.id, upgrade.upgraded.order.id, "cancel");
    expect(canceled.order).toMatchObject({ state: "processing", status: "pending", canCancel: false, canResume: false });
    expect(upgrade.invoice.status).toBe("open"); expect(voidCalls).toBe(1);
    expect((await orderPayments.manageOrderPayment(upgrade.buyer.id, upgrade.upgraded.order.id, "resume")).checkoutUrl).toBeUndefined();
    expect(voidCalls).toBe(1);
  } finally { stripe.invoicePayments.list = list; stripe.paymentIntents.retrieve = retrieve; stripe.invoices.voidInvoice = voidInvoice; }
});


test("DEV accepts Next's internal localhost URL only when the actual loopback Host and port match the browser Origin", async () => {
  const headers = { origin: "http://127.0.0.1:3011", host: "127.0.0.1:3011" };
  const local = () => new Request("http://localhost:3011/api/my-learning/orders/order_local", { method: "POST", headers });
  expect(payment.checkoutRequestOrigin(local())).toBe("http://127.0.0.1:3011");
  headers.host = "other.example:3011";
  expect(() => payment.checkoutRequestOrigin(local())).toThrow();
  headers.host = "127.0.0.1:3012"; headers.origin = "http://127.0.0.1:3012";
  expect(() => payment.checkoutRequestOrigin(local())).toThrow();
});
