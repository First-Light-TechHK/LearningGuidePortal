import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "os";
import path from "path";
import {
  COURSE_ID,
  PLAN_ID as COURSE_PLAN,
  activateThreeDayTrial,
  purchaseCourse,
  readProductData,
  verifiedUser,
  writeProductData,
} from "./helpers/my-learning";

const CATEGORY_PLAN = "european-humanities-pc-6";
const EVERYTHING_PLAN = "everything-pc-6";
const GRACE_MS = 3 * 24 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

const originalCwd = process.cwd();
const originalStorageBackend = process.env.STORAGE_BACKEND;
let isolatedCwd: string;
let store: typeof import("../../services/productStore");

before(async () => {
  isolatedCwd = await mkdtemp(path.join(tmpdir(), "lg-pay-invariants-"));
  process.chdir(isolatedCwd);
  process.env.STORAGE_BACKEND = "local";
  store = await import("../../services/productStore");
});

after(async () => {
  process.chdir(originalCwd);
  if (originalStorageBackend === undefined) delete process.env.STORAGE_BACKEND;
  else process.env.STORAGE_BACKEND = originalStorageBackend;
  if (isolatedCwd && path.dirname(isolatedCwd) === tmpdir()) {
    await rm(isolatedCwd, { recursive: true, force: true });
  }
});

async function attachStripeIds(userId: string, stripeSubscriptionId: string) {
  const data = await readProductData();
  const subscription = data.subscriptions.find((item: { userId: string; source: string }) => item.userId === userId && item.source === "purchase");
  const order = data.orders.find((item: { userId: string; status: string; kind?: string }) => item.userId === userId && item.status === "paid" && item.kind !== "trial_activation");
  assert.ok(subscription);
  assert.ok(order);
  subscription.stripeSubscriptionId = stripeSubscriptionId;
  order.stripeSubscriptionId = stripeSubscriptionId;
  order.paymentMode = "stripe";
  await writeProductData(data);
  return { subscription, order };
}

function withinMs(actualIso: string | undefined, expectedMs: number, slackMs = 5_000) {
  const actual = Date.parse(actualIso || "");
  assert.ok(Number.isFinite(actual), `expected a timestamp, got ${actualIso}`);
  assert.ok(Math.abs(actual - expectedMs) <= slackMs, `expected ~${new Date(expectedMs).toISOString()} got ${actualIso}`);
}

test("PAY-01: convertStripeTrial on a $0 invoice does not convert a trial into a purchase", async () => {
  const user = await verifiedUser(store, "pay01-zero-convert@example.test");
  await activateThreeDayTrial(store, user.id);
  const data = await readProductData();
  const trial = data.subscriptions.find((item: { userId: string; source: string }) => item.userId === user.id && item.source === "trial");
  assert.ok(trial);
  const originalValidTo = trial.validTo;
  trial.stripeSubscriptionId = "sub_pay01_zero";
  await writeProductData(data);

  const converted = await store.convertStripeTrial({
    subscriptionId: "sub_pay01_zero",
    invoiceId: "in_pay01_zero",
    amountMinor: 0,
  });
  assert.equal(converted, null);
  assert.equal((await store.checkEntitlement(user.id, COURSE_ID)).allowed, true);
  const after = await readProductData();
  const stillTrial = after.subscriptions.find((item: { userId: string; source: string }) => item.userId === user.id && item.source === "trial");
  assert.ok(stillTrial);
  assert.notEqual(stillTrial.state, "expired");
  assert.equal(stillTrial.validTo, originalValidTo);
  assert.equal(after.subscriptions.some((item: { userId: string; source: string }) => item.userId === user.id && item.source === "purchase"), false);
});

test("PAY-01: applyVerifiedStripeEvent $0 subscription_create invoice leaves source=trial", async () => {
  const user = await verifiedUser(store, "pay01-evt-zero@example.test");
  const { quote } = await store.createQuote(user.id, COURSE_PLAN, "trial");
  const pending = await store.createPendingDemoTrialOrderFromQuote(user.id, quote.id);
  const data = await readProductData();
  const order = data.orders.find((item: { id: string }) => item.id === pending.order.id);
  assert.ok(order);
  order.paymentMode = "stripe";
  await writeProductData(data);

  const start = new Date().toISOString();
  const trialEnd = new Date(Date.now() + 3 * DAY_MS).toISOString();
  await store.applyVerifiedStripeEvent({
    id: "evt_pay01_trial_checkout",
    type: "checkout.session.completed",
    action: "checkout",
    orderId: pending.order.id,
    sessionId: "cs_pay01_trial",
    subscriptionId: "sub_pay01_trial",
    customerId: "cus_pay01",
    periodStart: start,
    periodEnd: trialEnd,
    trial: true,
    subscriptionStatus: "trialing",
  });
  await store.applyVerifiedStripeEvent({
    id: "evt_pay01_zero_invoice",
    type: "invoice.paid",
    action: "invoice",
    subscriptionId: "sub_pay01_trial",
    invoiceId: "in_pay01_zero",
    amountMinor: 0,
    currency: "usd",
    status: "paid",
    billingReason: "subscription_create",
    subscriptionStatus: "trialing",
    periodStart: start,
    periodEnd: trialEnd,
  });
  const access = await store.checkEntitlement(user.id, COURSE_ID);
  assert.equal(access.allowed, true);
  assert.equal(access.source, "trial");
  const after = await readProductData();
  const trial = after.subscriptions.find((item: { stripeSubscriptionId?: string }) => item.stripeSubscriptionId === "sub_pay01_trial");
  assert.equal(trial?.source, "trial");
  assert.ok(Date.parse(trial?.validTo || "") < Date.now() + 30 * DAY_MS);
});

test("PAY-04: refunded purchase stays revoked after applyVerifiedStripeEvent invoice.paid", async () => {
  const user = await verifiedUser(store, "pay04-evt-refund@example.test");
  await purchaseCourse(store, user.id);
  const data = await readProductData();
  const subscription = data.subscriptions.find((item: { userId: string; source: string }) => item.userId === user.id && item.source === "purchase");
  const order = data.orders.find((item: { userId: string; status: string; kind?: string }) => item.userId === user.id && item.status === "paid" && item.kind !== "trial_activation");
  assert.ok(subscription);
  assert.ok(order);
  subscription.stripeSubscriptionId = "sub_pay04_refund";
  order.stripeSubscriptionId = "sub_pay04_refund";
  await writeProductData(data);
  await store.refundDemoOrder(order.id);
  assert.equal((await store.checkEntitlement(user.id, COURSE_ID)).allowed, false);

  const laterEnd = new Date(Date.now() + 180 * DAY_MS).toISOString();
  await store.applyVerifiedStripeEvent({
    id: "evt_pay04_after_refund",
    type: "invoice.paid",
    action: "invoice",
    subscriptionId: "sub_pay04_refund",
    invoiceId: "in_pay04_after_refund",
    amountMinor: 4900,
    currency: "usd",
    status: "paid",
    billingReason: "subscription_cycle",
    subscriptionStatus: "active",
    periodStart: new Date().toISOString(),
    periodEnd: laterEnd,
  });
  assert.equal((await store.checkEntitlement(user.id, COURSE_ID)).allowed, false);
  const after = await readProductData();
  assert.equal(after.entitlements.find((item: { userId: string; source: string }) => item.userId === user.id && item.source === "purchase")?.state, "revoked");
});

test("PAY-05: the same verified event id fulfils once", async () => {
  const user = await verifiedUser(store, "pay05-dup-evt@example.test");
  const { quote } = await store.createQuote(user.id, COURSE_PLAN);
  const pending = await store.createPendingDemoOrder(user.id, quote.id);
  const data = await readProductData();
  data.orders.find((item: { id: string }) => item.id === pending.order.id).paymentMode = "stripe";
  await writeProductData(data);
  const start = new Date().toISOString();
  const end = new Date(Date.now() + 180 * DAY_MS).toISOString();
  const event = {
    id: "evt_pay05_same",
    type: "checkout.session.completed",
    action: "checkout" as const,
    orderId: pending.order.id,
    sessionId: "cs_pay05",
    subscriptionId: "sub_pay05",
    customerId: "cus_pay05",
    periodStart: start,
    periodEnd: end,
    trial: false,
    subscriptionStatus: "active",
  };
  const first = await store.applyVerifiedStripeEvent(event);
  const second = await store.applyVerifiedStripeEvent(event);
  assert.equal((first as { duplicate?: boolean }).duplicate, false);
  assert.equal((second as { duplicate?: boolean }).duplicate, true);
  assert.equal((await store.checkEntitlement(user.id, COURSE_ID)).allowed, true);
  const after = await readProductData();
  const active = after.entitlements.filter((item: { userId: string; state: string }) => item.userId === user.id && item.state === "active");
  assert.equal(active.length, 1);
  assert.equal(after.stripeEvents.filter((item: { id: string }) => item.id === "evt_pay05_same").length, 1);
});

test("PAY-06: markStripeSubscriptionGrace anchors graceEndsAt at original validTo + 3 days", async () => {
  const user = await verifiedUser(store, "pay06-grace-anchor@example.test");
  await purchaseCourse(store, user.id);
  await attachStripeIds(user.id, "sub_pay06_grace");
  const before = (await store.getLearningOverview(user.id)).subscriptions.find((item) => item.source === "purchase");
  assert.ok(before);
  const originalValidTo = Date.parse(before.validTo);
  assert.ok(originalValidTo > Date.now() + 30 * DAY_MS, "fixture must be a paid term, not a 3-day window");

  const marked = await store.markStripeSubscriptionGrace("sub_pay06_grace");
  assert.ok(marked);
  assert.equal(marked.state, "grace");
  withinMs(marked.graceEndsAt || undefined, originalValidTo + GRACE_MS);
  withinMs(marked.validTo, originalValidTo + GRACE_MS);
  assert.ok(Date.parse(marked.validTo) > Date.now() + 30 * DAY_MS, "paid validTo must not collapse to now+3 days");

  const again = await store.markStripeSubscriptionGrace("sub_pay06_grace");
  assert.equal(again?.validTo, marked.validTo);
  assert.equal(again?.graceEndsAt, marked.graceEndsAt);
});

test("PAY-06: applyVerifiedStripeEvent payment_failed uses original period start + 3 days and is stable on retry", async () => {
  const user = await verifiedUser(store, "pay06-evt-grace@example.test");
  await purchaseCourse(store, user.id);
  const { subscription } = await attachStripeIds(user.id, "sub_pay06_evt");
  const originalValidTo = subscription.validTo;
  const periodStart = originalValidTo;
  const periodEnd = new Date(Date.parse(originalValidTo) + 180 * DAY_MS).toISOString();
  await store.applyVerifiedStripeEvent({
    id: "evt_pay06_fail",
    type: "invoice.payment_failed",
    action: "invoice",
    subscriptionId: "sub_pay06_evt",
    invoiceId: "in_pay06_fail",
    amountMinor: 0,
    status: "open",
    billingReason: "subscription_cycle",
    subscriptionStatus: "past_due",
    periodStart,
    periodEnd,
  });
  const first = (await readProductData()).subscriptions.find((item: { stripeSubscriptionId?: string }) => item.stripeSubscriptionId === "sub_pay06_evt");
  assert.equal(first.state, "grace");
  withinMs(first.graceEndsAt, Date.parse(originalValidTo) + GRACE_MS);
  await store.applyVerifiedStripeEvent({
    id: "evt_pay06_fail_retry",
    type: "invoice.payment_failed",
    action: "invoice",
    subscriptionId: "sub_pay06_evt",
    invoiceId: "in_pay06_fail",
    amountMinor: 0,
    status: "open",
    billingReason: "subscription_cycle",
    subscriptionStatus: "past_due",
    periodStart,
    periodEnd,
  });
  const second = (await readProductData()).subscriptions.find((item: { stripeSubscriptionId?: string }) => item.stripeSubscriptionId === "sub_pay06_evt");
  assert.equal(second.validTo, first.validTo);
  assert.equal(second.graceEndsAt, first.graceEndsAt);
});

test("PAY-07: applyStripePaidInvoice does not clear cancel_at_period_end", async () => {
  const user = await verifiedUser(store, "pay07-invoice-cancel@example.test");
  await purchaseCourse(store, user.id);
  const listed = await store.getLearningOverview(user.id);
  const current = listed.subscriptions.find((item) => item.source === "purchase");
  assert.ok(current);
  await store.cancelSubscription(user.id, current.id);
  await attachStripeIds(user.id, "sub_pay07_cancel");
  const laterEnd = new Date(Date.now() + 180 * DAY_MS).toISOString();
  await store.applyStripePaidInvoice({
    subscriptionId: "sub_pay07_cancel",
    invoiceId: "in_pay07_cycle",
    amountMinor: 4900,
    currentPeriodStart: new Date().toISOString(),
    currentPeriodEnd: laterEnd,
  });
  const after = (await readProductData()).subscriptions.find((item: { stripeSubscriptionId?: string }) => item.stripeSubscriptionId === "sub_pay07_cancel");
  assert.equal(after.cancelAtPeriodEnd, true);
  assert.equal(after.state, "cancel_at_period_end");
  await assert.rejects(() => store.resumeSubscription(user.id, current.id), /cannot be restored|cannot be resumed|cannot be restored/i);
});

test("PAY-07: applyVerifiedStripeEvent invoice.paid does not clear a local cancel_at_period_end", async () => {
  const user = await verifiedUser(store, "pay07-evt-keep@example.test");
  await purchaseCourse(store, user.id);
  const listed = await store.getLearningOverview(user.id);
  const current = listed.subscriptions.find((item) => item.source === "purchase");
  assert.ok(current);
  await store.cancelSubscription(user.id, current.id);
  await attachStripeIds(user.id, "sub_pay07_evt");
  const laterEnd = new Date(Date.now() + 180 * DAY_MS).toISOString();
  await store.applyVerifiedStripeEvent({
    id: "evt_pay07_invoice",
    type: "invoice.paid",
    action: "invoice",
    subscriptionId: "sub_pay07_evt",
    invoiceId: "in_pay07_evt",
    amountMinor: 4900,
    currency: "usd",
    status: "paid",
    billingReason: "subscription_cycle",
    subscriptionStatus: "active",
    cancelAtPeriodEnd: false,
    periodStart: new Date().toISOString(),
    periodEnd: laterEnd,
  });
  const after = (await readProductData()).subscriptions.find((item: { stripeSubscriptionId?: string }) => item.stripeSubscriptionId === "sub_pay07_evt");
  assert.equal(after.cancelAtPeriodEnd, true);
  assert.equal(after.state, "cancel_at_period_end");
  assert.equal((await store.checkEntitlement(user.id, COURSE_ID)).allowed, true);
});

test("PAY-08: overlapping purchase expires the previous entitlement row instead of deleting it", async () => {
  const user = await verifiedUser(store, "pay08-expire-row@example.test");
  await purchaseCourse(store, user.id);
  const before = await readProductData();
  const firstId = before.entitlements.find((item: { userId: string; state: string }) => item.userId === user.id && item.state === "active")?.id;
  assert.ok(firstId);

  const { quote } = await store.createQuote(user.id, CATEGORY_PLAN);
  const pending = await store.createPendingDemoOrder(user.id, quote.id);
  await store.completeDemoOrder(user.id, pending.order.id);

  const after = await readProductData();
  const rows = after.entitlements.filter((item: { userId: string }) => item.userId === user.id);
  const kept = rows.find((item: { id: string }) => item.id === firstId);
  assert.ok(kept, "previous entitlement row must remain for audit");
  assert.equal(kept.state, "expired");
  const active = rows.filter((item: { state: string }) => item.state === "active");
  assert.equal(active.length, 1);
  assert.equal((await store.checkEntitlement(user.id, COURSE_ID)).allowed, true);
});

test("PAY-05 / concurrency: two completeDemoOrder calls on one order leave a single active entitlement", async () => {
  const user = await verifiedUser(store, "pay05-race-complete@example.test");
  const { quote } = await store.createQuote(user.id, COURSE_PLAN);
  const pending = await store.createPendingDemoOrder(user.id, quote.id);
  const [first, second] = await Promise.all([
    store.completeDemoOrder(user.id, pending.order.id),
    store.completeDemoOrder(user.id, pending.order.id),
  ]);
  assert.equal(first.order.id, second.order.id);
  const after = await readProductData();
  const active = after.entitlements.filter((item: { userId: string; state: string }) => item.userId === user.id && item.state === "active");
  assert.equal(active.length, 1);
  assert.equal((await store.checkEntitlement(user.id, COURSE_ID)).allowed, true);
});

test("subscription lifecycle: trial convert, renew, grace, cancel-at-period-end, resume rejected, expire", async () => {
  const user = await verifiedUser(store, "pay-lifecycle@example.test");
  await activateThreeDayTrial(store, user.id);
  const data = await readProductData();
  const trial = data.subscriptions.find((item: { userId: string; source: string }) => item.userId === user.id && item.source === "trial");
  assert.ok(trial);
  trial.stripeSubscriptionId = "sub_lifecycle";
  await writeProductData(data);

  const converted = await store.convertStripeTrial({
    subscriptionId: "sub_lifecycle",
    invoiceId: "in_lifecycle_convert",
    amountMinor: 4900,
  });
  assert.ok(converted);
  assert.equal((await store.checkEntitlement(user.id, COURSE_ID)).source, "purchase");

  const renewedEnd = new Date(Date.now() + 360 * DAY_MS).toISOString();
  await store.applyStripePaidInvoice({
    subscriptionId: "sub_lifecycle",
    invoiceId: "in_lifecycle_renew",
    amountMinor: 4900,
    currentPeriodStart: new Date().toISOString(),
    currentPeriodEnd: renewedEnd,
  });
  const paid = (await readProductData()).subscriptions.find((item: { stripeSubscriptionId?: string; source: string }) => item.stripeSubscriptionId === "sub_lifecycle" && item.source === "purchase");
  assert.ok(paid);
  assert.equal(Date.parse(paid.validTo) >= Date.parse(renewedEnd) - 5_000, true);

  const originalPaidValidTo = paid.validTo;
  const failed = await store.markStripeSubscriptionGrace("sub_lifecycle");
  assert.equal(failed?.state, "grace");
  withinMs(failed?.graceEndsAt ?? undefined, Date.parse(originalPaidValidTo) + GRACE_MS);

  const recoveredEnd = new Date(Date.now() + 180 * DAY_MS).toISOString();
  await store.applyStripePaidInvoice({
    subscriptionId: "sub_lifecycle",
    invoiceId: "in_lifecycle_recover",
    amountMinor: 4900,
    currentPeriodStart: new Date().toISOString(),
    currentPeriodEnd: recoveredEnd,
  });
  const recovered = (await readProductData()).subscriptions.find((item: { stripeSubscriptionId?: string }) => item.stripeSubscriptionId === "sub_lifecycle");
  assert.ok(["active", "cancel_at_period_end"].includes(recovered.state));

  const listed = await store.getLearningOverview(user.id);
  const current = listed.subscriptions.find((item) => item.stripeSubscriptionId === "sub_lifecycle");
  assert.ok(current);
  await store.cancelSubscription(user.id, current.id);
  assert.equal((await store.checkEntitlement(user.id, COURSE_ID)).allowed, true);
  await assert.rejects(() => store.resumeSubscription(user.id, current.id));

  await store.applyVerifiedStripeEvent({
    id: "evt_lifecycle_deleted",
    type: "customer.subscription.deleted",
    action: "subscription",
    subscriptionId: "sub_lifecycle",
    status: "canceled",
    subscriptionStatus: "canceled",
  });
  assert.equal((await store.checkEntitlement(user.id, COURSE_ID)).allowed, false);
});

test("PAY-08 / applyStripeOrderState: overlapping Stripe resync expires rather than deletes", async () => {
  const user = await verifiedUser(store, "pay08-resync@example.test");
  await purchaseCourse(store, user.id);
  const firstId = (await readProductData()).entitlements.find((item: { userId: string; state: string }) => item.userId === user.id && item.state === "active")?.id;
  assert.ok(firstId);
  const { quote } = await store.createQuote(user.id, EVERYTHING_PLAN);
  const pending = await store.createPendingDemoOrder(user.id, quote.id);
  const data = await readProductData();
  const order = data.orders.find((item: { id: string }) => item.id === pending.order.id);
  order.paymentMode = "stripe";
  await writeProductData(data);
  await store.applyStripeOrderState({
    orderId: pending.order.id,
    operatorId: "operator",
    stripeStatus: "paid",
    subscriptionId: "sub_pay08_resync",
  });
  const after = await readProductData();
  const kept = after.entitlements.find((item: { id: string }) => item.id === firstId);
  assert.ok(kept);
  assert.equal(kept.state, "expired");
  assert.equal(after.entitlements.filter((item: { userId: string; state: string }) => item.userId === user.id && item.state === "active").length, 1);
});

