import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright";

const day = 86400;
const everything = "everything-pc-6";
const category = "european-humanities-pc-6";
const consents = { renewal: true, terms: true, refund: true };
const identity = value => typeof value === "string" ? value : value?.id;

async function waitFor(signal, check, message, timeout = 60000, interval = 750) {
  const deadline = Date.now() + timeout;
  do {
    signal.throwIfAborted();
    const result = await check();
    if (result) return result;
    await sleep(interval, undefined, { signal });
  } while (Date.now() < deadline);
  throw new Error(message);
}

// The launcher enforces a test key and gives this run a disposable Portal store and CLI listener.
export async function verifyStripePaymentFlows({ stripe, origin, delivered, signingSecret, signal, unpaidOnly }) {
  assert(process.env.STRIPE_SANDBOX === "1" && process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_"));
  const browser = await chromium.launch({ headless: unpaidOnly });
  const interruptBrowser = () => { void browser.close().catch(() => undefined); };
  signal.addEventListener("abort", interruptBrowser, { once: true });
  const sessionIds = new Set(), invoiceIds = new Set();
  const started = Math.floor(Date.now() / 1000) - 5;
  const received = async (type, objectId) => {
    let event;
    return waitFor(signal, async () => {
      event ??= (await stripe.events.list({ type, created: { gte: started }, limit: 100 })).data
        .find(item => !item.livemode && item.data.object.id === objectId);
      return event && delivered.has(event.id) && event;
    }, `No HTTP 200 from the CLI-forwarded ${type} webhook.`, 90000, 1500);
  };
  const replay = async (event, invalid = false) => {
    const payload = JSON.stringify(event);
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: invalid ? "whsec_invalid_test_only" : signingSecret });
    const response = await fetch(origin + "/api/payment/webhook", {
      method: "POST", headers: { "content-type": "application/json", "stripe-signature": signature }, body: payload
    });
    assert.equal(response.status, invalid ? 400 : 200);
    if (!invalid) assert.equal((await response.json()).duplicate, true, "Signed replay was processed again.");
  };
  const buyer = async () => {
    const context = await browser.newContext();
    const get = async path => {
      const response = await context.request.get(origin + path);
      assert.equal(response.status(), 200, `GET ${path} failed.`);
      return response.json();
    };
    const post = async (path, data) => {
      const response = await context.request.post(origin + path, { headers: { origin }, data });
      const result = await response.json();
      assert.equal(response.status(), 200, `POST ${path} failed (${result.code || "unknown"}).`);
      return result;
    };
    await post("/api/auth/register", { email: `stripe-e2e-${randomUUID()}@example.test`, password: "Disposable-payment-test1", nickname: "Sandbox Learner", locale: "en-GB", termsAccepted: true });
    const overview = async () => (await get("/api/my-learning")).overview;
    return {
      context, post, overview,
      subscriptions: async () => (await get("/api/subscription")).subscriptions,
      orders: async () => (await get("/api/my-learning/orders")).data.orders
    };
  };
  const quote = async (account, kind, fields) => (await account.post("/api/subscription/quote", { kind, ...fields })).quote;
  const activeAccess = async account => (await account.overview()).entitlements.filter(item => item.state === "active");
  const checkout = async (account, value, trial = false) => {
    const before = (await activeAccess(account)).map(item => item.id).sort();
    const result = await account.post(trial ? "/api/trial" : "/api/purchase/checkout", { quoteId: value.id, locale: "en-GB", consents });
    const session = await stripe.checkout.sessions.retrieve(result.order.stripeCheckoutSessionId);
    sessionIds.add(session.id);
    assert(!session.livemode && session.status === "open" && result.order.status === "pending");
    if (result.order.kind !== "upgrade") assert.equal(session.amount_total, result.order.amountMinor);
    assert.equal(session.currency, result.order.currency);
    assert.deepEqual((await activeAccess(account)).map(item => item.id).sort(), before, "An unpaid Checkout changed access.");
    return { order: result.order, session };
  };
  const checkPending = async account => {
    const purchaseQuote = await quote(account, "purchase", { planId: everything });
    const pending = await checkout(account, purchaseQuote);
    const repeated = await checkout(account, purchaseQuote);
    assert.equal(repeated.order.id, pending.order.id);
    assert.equal(repeated.session.id, pending.session.id);
    assert.equal((await activeAccess(account)).length, 0);
    return pending;
  };
  const complete = async (account, pending, label) => {
    const page = await account.context.newPage();
    try {
      assert.equal(new URL(pending.session.url).origin, "https://checkout.stripe.com");
      assert.equal(new URL(pending.session.success_url).origin, origin);
      console.log(`${label} Complete the opened Checkout using a Stripe test card.`);
      await page.goto(pending.session.url, { waitUntil: "domcontentloaded" });
      await page.waitForURL(pending.session.success_url, { timeout: 5 * 60 * 1000 });
    } finally { await page.close(); }
    const session = await stripe.checkout.sessions.retrieve(pending.session.id);
    assert.equal(session.status, "complete");
    const event = await received("checkout.session.completed", session.id);
    const subscription = await stripe.subscriptions.retrieve(identity(session.subscription));
    const invoice = await stripe.invoices.retrieve(identity(session.invoice));
    const local = await waitFor(signal, async () => (await account.subscriptions()).find(item => item.stripeSubscriptionId === subscription.id),
      "The Portal did not persist the Sandbox subscription.");
    return { event, subscription, invoice, local };
  };
  const subscriptionInvoice = async (purchase, payment) => {
    const subscription = purchase.subscription;
    const customer = identity(subscription.customer);
    const start = Math.floor(Date.parse(purchase.local.validTo) / 1000);
    const invoice = await stripe.invoices.create({ customer, subscription: subscription.id, auto_advance: false });
    invoiceIds.add(invoice.id);
    await stripe.invoiceItems.create({ customer, invoice: invoice.id, amount: 500, currency: "usd", period: { start, end: start + 30 * day } });
    const open = await stripe.invoices.finalizeInvoice(invoice.id, { auto_advance: false });
    assert.equal(open.status, "open");
    await payment(open.id, customer);
    return open.id;
  };
  const passed = (id, message) => console.log(`${id} passed ${message}`);

  try {
    signal.throwIfAborted();
    if (unpaidOnly) {
      const account = await buyer();
      const pending = await checkPending(account);
      await stripe.checkout.sessions.expire(pending.session.id);
      const event = await received("checkout.session.expired", pending.session.id);
      assert.equal((await account.orders()).find(order => order.id === pending.order.id)?.status, "canceled");
      await replay(event, true);
      await replay(event);
      assert.equal((await activeAccess(account)).length, 0);
      passed("PAY-03", "one quote produced one Checkout; the real expiry and its replay left the Order canceled and granted no access");
      return;
    }
    const trialBuyer = await buyer();
    const trialQuote = await quote(trialBuyer, "trial", { planId: everything });
    const trial = await complete(trialBuyer, await checkout(trialBuyer, trialQuote, true), "PAY-01");
    await received("invoice.paid", trial.invoice.id);
    assert.equal(trial.invoice.amount_paid, 0);
    assert.equal(trial.subscription.status, "trialing");
    assert.equal(trial.subscription.trial_end - trial.subscription.trial_start, 3 * day);
    assert.deepEqual((await trialBuyer.subscriptions()).map(item => item.source), ["trial"]);
    passed("PAY-01", "the zero-dollar invoice kept the three-day trial");

    const upgradeBuyer = await buyer();
    const source = await complete(upgradeBuyer, await checkout(upgradeBuyer, await quote(upgradeBuyer, "purchase", { planId: category })), "PAY-02 source");
    await received("invoice.paid", source.invoice.id);
    const upgrade = await complete(upgradeBuyer, await checkout(upgradeBuyer, await quote(upgradeBuyer, "upgrade", { subscriptionId: source.local.id })), "PAY-02 upgrade");
    assert.notEqual(upgrade.subscription.id, source.subscription.id);
    await waitFor(signal, async () => (await stripe.subscriptions.retrieve(source.subscription.id)).status === "canceled", "The source Stripe subscription was not canceled.");
    assert.deepEqual((await activeAccess(upgradeBuyer)).map(item => item.scope), ["everything"]);
    passed("PAY-02", "the paid upgrade canceled the original Stripe subscription");

    const account = await buyer();
    const pending = await checkPending(account);
    passed("PAY-03", "one quote produced one unpaid Checkout and no access");
    const purchase = await complete(account, pending, "PAY-04/05/07");
    const paid = await received("invoice.paid", purchase.invoice.id);
    await replay(purchase.event, true);
    await replay(purchase.event);
    await replay(paid);
    assert.equal((await activeAccess(account)).length, 1);
    assert.equal((await account.subscriptions()).length, 1);
    passed("PAY-05", "invalid signature was rejected and two authentic event replays granted access once");

    await account.post("/api/subscription", { action: "cancel", subscriptionId: purchase.local.id });
    assert.equal((await stripe.subscriptions.retrieve(purchase.subscription.id)).cancel_at_period_end, true);
    const cancelInvoice = await subscriptionInvoice(purchase, id => stripe.invoices.pay(id, { paid_out_of_band: true }));
    await received("invoice.paid", cancelInvoice);
    assert.equal((await account.subscriptions())[0].state, "cancel_at_period_end");
    assert.equal((await activeAccess(account)).length, 1);
    passed("PAY-07", "a new paid invoice kept the cancellation and access");

    const payments = await stripe.invoicePayments.list({ invoice: purchase.invoice.id, status: "paid" });
    const paymentIntent = payments.data.map(item => identity(item.payment.payment_intent)).find(Boolean);
    assert(paymentIntent, "The initial paid invoice has no payment intent.");
    const refund = await stripe.refunds.create({ payment_intent: paymentIntent });
    await received("charge.refunded", identity(refund.charge));
    await waitFor(signal, async () => !(await activeAccess(account)).length, "The full refund did not revoke access.");
    const laterInvoice = await subscriptionInvoice(purchase, id => stripe.invoices.pay(id, { paid_out_of_band: true }));
    await received("invoice.paid", laterInvoice);
    assert.equal((await activeAccess(account)).length, 0);
    assert.equal((await account.orders()).find(order => order.id === pending.order.id)?.status, "refunded");
    passed("PAY-04", "the refund revoked access and a later paid invoice left it revoked");

    const graceBuyer = await buyer();
    const grace = await complete(graceBuyer, await checkout(graceBuyer, await quote(graceBuyer, "purchase", { planId: everything })), "PAY-06");
    await received("invoice.paid", grace.invoice.id);
    const failedInvoice = await subscriptionInvoice(grace, async (id, customer) => {
      const method = await stripe.paymentMethods.attach("pm_card_chargeCustomerFail", { customer });
      await assert.rejects(stripe.invoices.pay(id, { payment_method: method.id }), error => error.type === "StripeCardError");
    });
    await received("invoice.payment_failed", failedInvoice);
    const graceSubscription = (await graceBuyer.subscriptions())[0];
    assert.equal(graceSubscription.state, "grace");
    assert.equal(Date.parse(graceSubscription.graceEndsAt), Date.parse(grace.local.validTo) + 3 * day * 1000);
    passed("PAY-06", "the failed invoice left exactly three days of grace after the original period");
  } finally {
    signal.removeEventListener("abort", interruptBrowser);
    await browser.close().catch(() => undefined);
    for (const id of invoiceIds) {
      const invoice = await stripe.invoices.retrieve(id).catch(() => null);
      if (invoice?.status === "open") await stripe.invoices.voidInvoice(id).catch(() => console.warn("Could not void an unpaid Sandbox test invoice."));
    }
    for (const id of sessionIds) {
      const session = await stripe.checkout.sessions.retrieve(id).catch(() => null);
      try {
        if (session?.status === "open") await stripe.checkout.sessions.expire(id);
        const subscriptionId = identity(session?.subscription);
        if (subscriptionId && (await stripe.subscriptions.retrieve(subscriptionId)).status !== "canceled") {
          await stripe.subscriptions.cancel(subscriptionId, { invoice_now: false, prorate: false });
        }
      } catch { console.warn("Could not close a Sandbox test Checkout or subscription."); }
    }
  }
}
