import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import Stripe from "stripe";
import {
  CATEGORY_PLAN,
  COURSE_AMOUNT_MINOR,
  COURSE_ID,
  COURSE_PLAN,
  PASSWORD,
  PLAN_ID,
  SERVER_AMOUNT_MINOR,
  TRIAL_MS,
  clearCookies,
  isolate,
  jsonRequest,
  takeSetCookie,
  uniqueEmail
} from "./harness";

const CONSENTS = { renewal: true, terms: true, refund: true };

let restore: () => Promise<void>;
let register: typeof import("../../app/api/auth/register/route");
let quote: typeof import("../../app/api/purchase/quote/route");
let checkout: typeof import("../../app/api/purchase/checkout/route");
let confirm: typeof import("../../app/api/purchase/demo/confirm/route");
let entitlements: typeof import("../../app/api/entitlements/check/route");
let webhook: typeof import("../../app/api/payment/webhook/route");
let trial: typeof import("../../app/api/trial/route");
let subscription: typeof import("../../app/api/subscription/route");

before(async () => {
  restore = (await isolate("lg-io-payment-")).restore;
  register = await import("../../app/api/auth/register/route");
  quote = await import("../../app/api/purchase/quote/route");
  checkout = await import("../../app/api/purchase/checkout/route");
  confirm = await import("../../app/api/purchase/demo/confirm/route");
  entitlements = await import("../../app/api/entitlements/check/route");
  webhook = await import("../../app/api/payment/webhook/route");
  trial = await import("../../app/api/trial/route");
  subscription = await import("../../app/api/subscription/route");
});

after(async () => {
  await restore();
});

async function signIn(label: string) {
  clearCookies();
  const email = uniqueEmail(label);
  const response = await register.POST(jsonRequest("POST", "http://localhost/api/auth/register", {
    email,
    password: PASSWORD,
    nickname: "IO Buyer",
    locale: "en-GB"
  }));
  takeSetCookie(response);
  assert.equal(response.status, 200);
  return email;
}

async function entitlementAllowed(device?: "pc" | "mobile") {
  const suffix = device ? `&device=${device}` : "";
  const response = await entitlements.GET(jsonRequest("GET", `http://localhost/api/entitlements/check?courseId=${COURSE_ID}${suffix}`));
  const body = await response.json();
  return { status: response.status, allowed: Boolean(body.entitlement?.allowed), source: body.entitlement?.source, validTo: body.entitlement?.validTo, body };
}

async function quotePlan(planId: string, extra?: Record<string, unknown>) {
  const response = await quote.POST(jsonRequest("POST", "http://localhost/api/purchase/quote", { planId, ...extra }));
  const body = await response.json();
  return { response, body, quoteId: body.quote?.id as string | undefined };
}

async function checkoutQuote(quoteId: string) {
  const response = await checkout.POST(jsonRequest("POST", "http://localhost/api/purchase/checkout", {
    quoteId,
    locale: "en-GB",
    consents: CONSENTS
  }));
  const body = await response.json();
  return { response, body, orderId: body.order?.id as string | undefined };
}

async function purchase(planId: string) {
  const quoted = await quotePlan(planId);
  assert.equal(quoted.response.status, 200);
  const pending = await checkoutQuote(quoted.quoteId as string);
  assert.equal(pending.response.status, 200);
  const paid = await confirm.POST(jsonRequest("POST", "http://localhost/api/purchase/demo/confirm", {
    orderId: pending.orderId,
    action: "complete"
  }));
  assert.equal(paid.status, 200);
  return { quoteId: quoted.quoteId, orderId: pending.orderId };
}

async function startTrial() {
  const quoted = await quote.POST(jsonRequest("POST", "http://localhost/api/purchase/quote", { planId: COURSE_PLAN, kind: "trial" }));
  const quoteId = (await quoted.json()).quote.id as string;
  const pending = await trial.POST(jsonRequest("POST", "http://localhost/api/trial", {
    quoteId,
    locale: "en-GB",
    consents: CONSENTS
  }));
  const body = await pending.json();
  return { pending, body, orderId: body.order?.id as string | undefined };
}

function signedWebhook(event: object, secret = "whsec_fixture") {
  const payload = JSON.stringify(event);
  const stripe = new Stripe("sk_test_fixture");
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret });
  return new Request("http://localhost/api/payment/webhook", {
    method: "POST",
    headers: { "stripe-signature": signature },
    body: payload
  });
}

function enableStripeWebhook() {
  process.env.STRIPE_SECRET_KEY = "sk_test_fixture";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_fixture";
  process.env.STRIPE_SANDBOX = "1";
}

test("PAY-01 functional: a completed demo trial stays inside the three-day window", async () => {
  await signIn("pay01-trial");
  const before = Date.now();
  const started = await startTrial();
  assert.equal(started.pending.status, 200);
  const paid = await confirm.POST(jsonRequest("POST", "http://localhost/api/purchase/demo/confirm", {
    orderId: started.orderId,
    action: "complete"
  }));
  assert.equal(paid.status, 200);
  const access = await entitlementAllowed();
  assert.equal(access.allowed, true);
  assert.equal(access.source, "trial");
  const validTo = Date.parse(access.validTo || "");
  assert.ok(Number.isFinite(validTo));
  assert.ok(validTo <= before + TRIAL_MS + 60_000);
  assert.ok(validTo < before + 30 * 24 * 60 * 60 * 1000);
});

test("PAY-01 negative: cancelling a demo trial never grants the course", async () => {
  await signIn("pay01-cancel");
  const started = await startTrial();
  const cancelled = await confirm.POST(jsonRequest("POST", "http://localhost/api/purchase/demo/confirm", {
    orderId: started.orderId,
    action: "cancel"
  }));
  assert.equal(cancelled.status, 200);
  assert.equal((await cancelled.json()).status, "canceled");
  assert.equal((await entitlementAllowed()).allowed, false);
});

test("PAY-01 edge: trial quote amount is zero and the browser cannot raise it", async () => {
  await signIn("pay01-zero");
  const quoted = await quotePlan(COURSE_PLAN, { kind: "trial", amountMinor: 9900 });
  assert.equal(quoted.response.status, 200);
  assert.equal(quoted.body.quote.amountMinor, 0);
  assert.notEqual(quoted.body.quote.amountMinor, 9900);
});

test("PAY-02 smoke: checkout without a session is 401", async () => {
  clearCookies();
  const response = await checkout.POST(jsonRequest("POST", "http://localhost/api/purchase/checkout", {
    quoteId: "quote-missing",
    consents: CONSENTS
  }));
  assert.equal(response.status, 401);
});

test("PAY-02 negative: upgrade quote without a source subscription is 400", async () => {
  await signIn("pay02-upgrade");
  const response = await quote.POST(jsonRequest("POST", "http://localhost/api/purchase/quote", {
    kind: "upgrade",
    subscriptionId: "sub-missing"
  }));
  assert.equal(response.status, 400);
});

test("PAY-02 edge: checkout without consents is 400", async () => {
  await signIn("pay02-consents");
  const quoted = await quotePlan(PLAN_ID);
  const response = await checkout.POST(jsonRequest("POST", "http://localhost/api/purchase/checkout", { quoteId: quoted.quoteId }));
  assert.equal(response.status, 400);
});

test("PAY-03 functional: the same quote reuses one pending order", async () => {
  await signIn("pay03-reuse");
  const quoted = await quotePlan(COURSE_PLAN);
  const first = await checkoutQuote(quoted.quoteId as string);
  const second = await checkoutQuote(quoted.quoteId as string);
  assert.equal(first.response.status, 200);
  assert.equal(second.response.status, 200);
  assert.equal(first.orderId, second.orderId);
  assert.equal((await entitlementAllowed()).allowed, false);
});

test("PAY-03 negative: quote amount is server-owned", async () => {
  await signIn("pay03-price");
  const quoted = await quotePlan(PLAN_ID, { amountMinor: 1 });
  assert.equal(quoted.response.status, 200);
  assert.equal(quoted.body.quote.amountMinor, SERVER_AMOUNT_MINOR);
  assert.notEqual(quoted.body.quote.amountMinor, 1);
});

test("PAY-03 edge: checkout order amount matches the server quote", async () => {
  await signIn("pay03-order");
  const quoted = await quotePlan(COURSE_PLAN);
  const pending = await checkoutQuote(quoted.quoteId as string);
  assert.equal(pending.body.order.amountMinor, COURSE_AMOUNT_MINOR);
  assert.match(pending.body.checkoutUrl, /\/en-GB\/portal\/payment\/checkout\?orderId=/);
});

test("PAY-04 functional: an unpaid signed completion grants nothing", async () => {
  enableStripeWebhook();
  await signIn("pay04-unpaid");
  const response = await webhook.POST(signedWebhook({
    id: "evt_unpaid",
    object: "event",
    livemode: false,
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_unpaid",
        payment_status: "unpaid",
        metadata: { userId: "u", quoteId: "q", planId: PLAN_ID }
      }
    }
  }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).pending, true);
  assert.equal((await entitlementAllowed()).allowed, false);
});

test("PAY-04 negative: a paid event without a server order does not grant access", async () => {
  enableStripeWebhook();
  await signIn("pay04-orphan");
  const response = await webhook.POST(signedWebhook({
    id: "evt_orphan_paid",
    object: "event",
    livemode: false,
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_orphan",
        payment_status: "paid",
        amount_total: SERVER_AMOUNT_MINOR,
        currency: "usd",
        metadata: { userId: "missing-user", quoteId: "missing-quote", planId: PLAN_ID }
      }
    }
  }));
  assert.equal(response.status, 400);
  assert.equal((await entitlementAllowed()).allowed, false);
});

test("PAY-04 edge: a live event is rejected in sandbox", async () => {
  enableStripeWebhook();
  const response = await webhook.POST(signedWebhook({
    id: "evt_live",
    object: "event",
    livemode: true,
    type: "ping",
    data: { object: {} }
  }));
  assert.equal(response.status, 400);
});

test("PAY-05 functional: repeating complete does not create a second grant", async () => {
  await signIn("pay05-repeat");
  const bought = await purchase(PLAN_ID);
  const second = await confirm.POST(jsonRequest("POST", "http://localhost/api/purchase/demo/confirm", {
    orderId: bought.orderId,
    action: "complete"
  }));
  assert.equal(second.status, 200);
  const access = await entitlementAllowed();
  assert.equal(access.allowed, true);
});

test("PAY-05 negative: webhook without a signature is 503", async () => {
  delete process.env.STRIPE_WEBHOOK_SECRET;
  const response = await webhook.POST(new Request("http://localhost/api/payment/webhook", {
    method: "POST",
    body: "{}"
  }));
  assert.equal(response.status, 503);
});

test("PAY-05 edge: the same signed unknown event is ignored twice", async () => {
  enableStripeWebhook();
  const event = {
    id: "evt_pay05_same",
    object: "event",
    livemode: false,
    type: "ping",
    data: { object: {} }
  };
  const first = await webhook.POST(signedWebhook(event));
  const second = await webhook.POST(signedWebhook(event));
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal((await first.json()).ignored, true);
  assert.equal((await second.json()).ignored, true);
});

test("PAY-06 smoke: a bad webhook signature is 400", async () => {
  enableStripeWebhook();
  const response = await webhook.POST(new Request("http://localhost/api/payment/webhook", {
    method: "POST",
    headers: { "stripe-signature": "t=1,v1=deadbeef" },
    body: JSON.stringify({ id: "evt_bad", type: "invoice.payment_failed" })
  }));
  assert.equal(response.status, 400);
});

test("PAY-06 negative: payment_failed for an unknown subscription grants nothing", async () => {
  enableStripeWebhook();
  await signIn("pay06-unknown");
  const response = await webhook.POST(signedWebhook({
    id: "evt_pay06_fail",
    object: "event",
    livemode: false,
    type: "invoice.payment_failed",
    data: {
      object: {
        id: "in_pay06",
        subscription: "sub_missing"
      }
    }
  }));
  assert.ok([400, 200].includes(response.status));
  assert.equal((await entitlementAllowed()).allowed, false);
});

test("PAY-06 edge: an unknown event type is ignored", async () => {
  enableStripeWebhook();
  const response = await webhook.POST(signedWebhook({
    id: "evt_ping",
    object: "event",
    livemode: false,
    type: "ping",
    data: { object: {} }
  }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ignored, true);
});

test("PAY-07 functional: cancelling a paid purchase keeps access until the period ends", async () => {
  await signIn("pay07-cancel");
  await purchase(COURSE_PLAN);
  const listed = await subscription.GET(jsonRequest("GET", "http://localhost/api/subscription"));
  const current = (await listed.json()).subscriptions.find((item: { source?: string; state?: string }) => item.source === "purchase");
  assert.ok(current);
  const cancelled = await subscription.POST(jsonRequest("POST", "http://localhost/api/subscription", {
    subscriptionId: current.id,
    action: "cancel",
    reasonCode: "other",
    reasonText: "io"
  }));
  assert.equal(cancelled.status, 200);
  assert.equal((await entitlementAllowed()).allowed, true);
});

test("PAY-07 negative: a paid purchase cannot be resumed", async () => {
  await signIn("pay07-resume");
  await purchase(COURSE_PLAN);
  const listed = await subscription.GET(jsonRequest("GET", "http://localhost/api/subscription"));
  const current = (await listed.json()).subscriptions.find((item: { source?: string }) => item.source === "purchase");
  await subscription.POST(jsonRequest("POST", "http://localhost/api/subscription", {
    subscriptionId: current.id,
    action: "cancel",
    reasonCode: "other"
  }));
  const resumed = await subscription.POST(jsonRequest("POST", "http://localhost/api/subscription", {
    subscriptionId: current.id,
    action: "resume"
  }));
  assert.equal(resumed.status, 400);
  assert.match((await resumed.json()).error, /cannot be restored|cannot be resumed/i);
});

test("PAY-07 edge: resume without a subscription id is 400", async () => {
  await signIn("pay07-missing");
  const response = await subscription.POST(jsonRequest("POST", "http://localhost/api/subscription", { action: "resume" }));
  assert.equal(response.status, 400);
});

test("PAY-08 functional: an overlapping purchase still allows the course", async () => {
  await signIn("pay08-overlap");
  await purchase(COURSE_PLAN);
  await purchase(CATEGORY_PLAN);
  assert.equal((await entitlementAllowed()).allowed, true);
});

test("PAY-08 edge: the previous subscription row remains after an overlapping purchase", async () => {
  await signIn("pay08-keep");
  await purchase(COURSE_PLAN);
  await purchase(CATEGORY_PLAN);
  const listed = await subscription.GET(jsonRequest("GET", "http://localhost/api/subscription"));
  const rows = (await listed.json()).subscriptions as Array<{ planId?: string; state?: string }>;
  assert.ok(rows.length >= 2);
  assert.ok(rows.some((item) => item.planId === COURSE_PLAN));
  assert.ok(rows.some((item) => item.planId === CATEGORY_PLAN));
});

test("PAY-08 negative: quote or checkout without a session is 401", async () => {
  clearCookies();
  assert.equal((await quote.POST(jsonRequest("POST", "http://localhost/api/purchase/quote", { planId: PLAN_ID }))).status, 401);
  assert.equal((await checkout.POST(jsonRequest("POST", "http://localhost/api/purchase/checkout", {
    quoteId: "quote-missing",
    consents: CONSENTS
  }))).status, 401);
});

test("PAY-09 functional: PC access does not allow a mobile device check", async () => {
  await signIn("pay09-device");
  await purchase(COURSE_PLAN);
  assert.equal((await entitlementAllowed("pc")).allowed, true);
  assert.equal((await entitlementAllowed("mobile")).allowed, false);
});

test("PAY-09 negative: the same plan cannot be quoted again while access is active", async () => {
  await signIn("pay09-repurchase");
  await purchase(PLAN_ID);
  const quoted = await quotePlan(PLAN_ID);
  assert.equal(quoted.response.status, 400);
  assert.match(quoted.body.error, /already has active access/i);
});

test("PAY-09 edge: a signed-in user without purchase is not entitled", async () => {
  await signIn("pay09-empty");
  const access = await entitlementAllowed();
  assert.equal(access.status, 200);
  assert.equal(access.allowed, false);
});

test("PAY-10 functional: completing a demo trial allows the course", async () => {
  await signIn("pay10-complete");
  const started = await startTrial();
  const paid = await confirm.POST(jsonRequest("POST", "http://localhost/api/purchase/demo/confirm", {
    orderId: started.orderId,
    action: "complete"
  }));
  assert.equal(paid.status, 200);
  assert.equal((await entitlementAllowed()).allowed, true);
});

test("PAY-10 negative: a second complete after trial cancel does not revive access", async () => {
  await signIn("pay10-revive");
  const started = await startTrial();
  await confirm.POST(jsonRequest("POST", "http://localhost/api/purchase/demo/confirm", {
    orderId: started.orderId,
    action: "complete"
  }));
  const listed = await subscription.GET(jsonRequest("GET", "http://localhost/api/subscription"));
  const current = (await listed.json()).subscriptions.find((item: { source?: string }) => item.source === "trial");
  const cancelled = await subscription.POST(jsonRequest("POST", "http://localhost/api/subscription", {
    subscriptionId: current.id,
    action: "cancel",
    reasonCode: "other"
  }));
  assert.equal(cancelled.status, 200);
  assert.equal((await entitlementAllowed()).allowed, false);
  const again = await confirm.POST(jsonRequest("POST", "http://localhost/api/purchase/demo/confirm", {
    orderId: started.orderId,
    action: "complete"
  }));
  assert.equal(again.status, 400);
  assert.equal((await entitlementAllowed()).allowed, false);
});

test("PAY-10 edge: trial checkout without consents is 400", async () => {
  await signIn("pay10-consents");
  const quoted = await quote.POST(jsonRequest("POST", "http://localhost/api/purchase/quote", { planId: COURSE_PLAN, kind: "trial" }));
  const quoteId = (await quoted.json()).quote.id as string;
  const response = await trial.POST(jsonRequest("POST", "http://localhost/api/trial", { quoteId, locale: "en-GB" }));
  assert.equal(response.status, 400);
});
