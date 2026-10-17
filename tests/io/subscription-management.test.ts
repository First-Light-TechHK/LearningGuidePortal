import assert from "node:assert/strict";
import { test } from "node:test";
import { isolate, setCookie, clearCookies, SESSION_COOKIE, jsonRequest } from "./harness";
import { verifiedUser, readProductData, writeProductData } from "../unit/helpers/my-learning";
import { getMessages } from "../../lib/i18n/messages";

test("Stripe cancellation retains access/end date and recovers a lost response with the same persisted operation", async () => {
  const { restore } = await isolate("lg-subscription-change-");
  try {
    const store = await import("../../services/productStore"), buyer = await verifiedUser(store, "cancel@example.test");
    const { quote } = await store.createQuote(buyer.id, "science-pc-6"), purchased = await store.completeDemoCheckout(buyer.id, quote.id);
    let data = await readProductData();
    const source = data.subscriptions.find((s: { id: string }) => s.id === purchased.subscription.id);
    Object.assign(source, { stripeSubscriptionId: "sub_cancel", stripeCustomerId: "cus_cancel" }); await writeProductData(data);
    process.env.PAYMENT_MODE = "stripe"; process.env.STRIPE_SECRET_KEY = "sk_test_cancel_fixture";
    const { getStripe } = await import("../../services/stripeClient"), stripe = getStripe();
    const remote = { id: "sub_cancel", customer: "cus_cancel", status: "active", cancel_at_period_end: false };
    let lost = true; const calls: { input: unknown; key?: string }[] = [];
    stripe.subscriptions.retrieve = (async () => remote) as typeof stripe.subscriptions.retrieve;
    stripe.subscriptions.update = (async (_id, input, options) => {
      calls.push({ input, key: options?.idempotencyKey }); remote.cancel_at_period_end = Boolean(input?.cancel_at_period_end);
      if (lost) { lost = false; throw new Error("Provider response lost"); }
      return remote;
    }) as typeof stripe.subscriptions.update;
    const { changeUserSubscription } = await import("../../services/subscriptionManagementService");
    const input = { subscriptionId: source.id, action: "cancel" as const, reasonCode: "other" as const, reasonText: "Optional feedback" };
    await assert.rejects(() => changeUserSubscription(buyer.id, input), { code: "provider_unavailable" });
    data = await readProductData(); let saved = data.subscriptions.find((s: { id: string }) => s.id === source.id);
    assert.equal(saved.state, "active"); assert.equal(saved.validTo, source.validTo); assert.equal(saved.renewalChange.completed, false);
    const canceled = await changeUserSubscription(buyer.id, input);
    assert.equal(canceled.state, "cancel_at_period_end"); assert.equal(canceled.validTo, source.validTo); assert.equal(canceled.validFrom, source.validFrom);
    assert.deepEqual(calls[0], calls[1]); assert.deepEqual(calls[0].input, { cancel_at_period_end: true }); assert.ok(calls[0].key?.startsWith("learning-guide-renewal-"));
    await changeUserSubscription(buyer.id, input); assert.equal(calls.length, 2);
    data = await readProductData(); saved = data.subscriptions.find((s: { id: string }) => s.id === source.id);
    assert.equal(saved.cancelReasonCode, "other"); assert.equal(saved.cancelReasonText, "Optional feedback"); assert.equal(saved.renewalChange.completed, true);
    assert.equal(data.entitlements.find((e: { userId: string }) => e.userId === buyer.id).state, "active");
    assert.equal(data.notifications.filter((n: { userId: string; title: string }) => n.userId === buyer.id && n.title === "Subscription updated").length, 1);
    const session = await store.createSession(buyer.id); setCookie(SESSION_COOKIE, session.token);
    const route = await import("../../app/api/subscription/route");
    assert.equal((await route.POST(jsonRequest("POST", "http://localhost/api/subscription", input))).status, 200);
    assert.equal(calls.length, 2);
    for (const invalid of [{ ...input, reasonCode: "unknown" }, { ...input, reasonText: "x".repeat(501) }, { action: "cancel" }, null]) {
      assert.equal((await route.POST(jsonRequest("POST", "http://localhost/api/subscription", invalid))).status, 400);
    }
    clearCookies(); assert.equal((await route.POST(jsonRequest("POST", "http://localhost/api/subscription", input))).status, 401);
    const other = await verifiedUser(store, "cancel-other@example.test"), otherSession = await store.createSession(other.id); setCookie(SESSION_COOKIE, otherSession.token);
    assert.equal((await route.POST(jsonRequest("POST", "http://localhost/api/subscription", input))).status, 404); assert.equal(calls.length, 2);
    setCookie(SESSION_COOKIE, session.token);
    const resumed = await route.POST(jsonRequest("POST", "http://localhost/api/subscription", { subscriptionId: source.id, action: "resume" }));
    assert.equal(resumed.status, 200); assert.equal((await resumed.json()).subscription.validTo, source.validTo); assert.equal(calls.length, 3);
    assert.deepEqual(calls[2].input, { cancel_at_period_end: false }); assert.notEqual(calls[2].key, calls[0].key);
    await route.POST(jsonRequest("POST", "http://localhost/api/subscription", { subscriptionId: source.id, action: "resume" })); assert.equal(calls.length, 3);
    data = await readProductData(); data.subscriptions.find((s: { id: string }) => s.id === source.id).state = "expired"; await writeProductData(data);
    assert.equal((await route.POST(jsonRequest("POST", "http://localhost/api/subscription", input))).status, 400); assert.equal(calls.length, 3);
    assert.equal((await route.POST(jsonRequest("POST", "http://localhost/api/subscription", { subscriptionId: source.id, action: "resume" }))).status, 400); assert.equal(calls.length, 3);
  } finally { await restore(); }
});

test("wrong Stripe customer cannot be cancelled and the API localises failure without changing local access", async () => {
  const { restore } = await isolate("lg-subscription-owner-");
  try {
    const store = await import("../../services/productStore"), buyer = await verifiedUser(store, "cancel-owner@example.test");
    const { quote } = await store.createQuote(buyer.id, "science-pc-6"), purchased = await store.completeDemoCheckout(buyer.id, quote.id);
    const data = await readProductData(); data.users.find((u: { id: string }) => u.id === buyer.id).locale = "zh-CN";
    Object.assign(data.subscriptions.find((s: { id: string }) => s.id === purchased.subscription.id), { stripeSubscriptionId: "sub_owner", stripeCustomerId: "cus_owner" }); await writeProductData(data);
    process.env.PAYMENT_MODE = "stripe"; process.env.STRIPE_SECRET_KEY = "sk_test_cancel_fixture";
    const { getStripe } = await import("../../services/stripeClient"), stripe = getStripe(); let calls = 0;
    stripe.subscriptions.retrieve = (async () => ({ id: "sub_owner", customer: "cus_other", status: "active", cancel_at_period_end: false })) as typeof stripe.subscriptions.retrieve;
    stripe.subscriptions.update = (async () => { calls++; throw new Error("Must not mutate another customer"); }) as typeof stripe.subscriptions.update;
    const session = await store.createSession(buyer.id); setCookie(SESSION_COOKIE, session.token);
    const route = await import("../../app/api/subscription/route");
    process.env.PAYMENT_MODE = "disabled";
    assert.equal((await route.POST(jsonRequest("POST", "http://localhost/api/subscription", { subscriptionId: purchased.subscription.id, action: "cancel" }))).status, 503);
    assert.equal((await readProductData()).subscriptions[0].renewalChange, undefined);
    process.env.PAYMENT_MODE = "stripe";
    const response = await route.POST(jsonRequest("POST", "http://localhost/api/subscription", { subscriptionId: purchased.subscription.id, action: "cancel" }));
    assert.equal(response.status, 503); assert.equal((await response.json()).error, getMessages("zh-CN").subscriptionErrors.provider_unavailable); assert.equal(calls, 0);
    assert.equal((await store.getLearningOverview(buyer.id)).subscriptions[0].state, "active");
  } finally { await restore(); }
});
