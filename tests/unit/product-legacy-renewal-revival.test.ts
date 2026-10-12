import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { COURSE_ID, writeProductData } from "./helpers/my-learning";

// Break: D3 — a paid legacy renewal leaves course access dead. applyStripePaidInvoice
// (the invoice path every legacy Stripe subscription with no price snapshot takes)
// revives the subscription but only extends the entitlement `if state === "active"`;
// a swept/expired entitlement stays expired, so the Subscription surface shows
// "Active — valid until <future>" while My Learning's current access is empty and
// the Study Group dropdown refuses the course.

const DAY = 86_400_000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

const USER_ID = "u-legacy-renewal";
const PLAN_ID = "epicureanism-pc-6";
const SUBSCRIPTION_ID = "s-legacy";
const STRIPE_SUBSCRIPTION_ID = "sub_legacy_1";

const originalCwd = process.cwd();
const originalStorageBackend = process.env.STORAGE_BACKEND;
let isolatedCwd: string;
let store: typeof import("../../services/productStore");

before(async () => {
  isolatedCwd = await mkdtemp(path.join(tmpdir(), "lg-product-legacy-renewal-"));
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

test("a paid legacy renewal keeps the entitlement alive alongside the revived subscription", async () => {
  const now = new Date().toISOString();
  const data = await store.ensureProductData();
  data.users.push({ id: USER_ID, email: "d3-legacy@example.test", passwordHash: null, nickname: "Legacy Renewal", locale: "en-GB", role: "student", status: "active", emailVerifiedAt: now, createdAt: now });
  // Legacy shape: the Stripe order predates price snapshots (no `price` field),
  // which is what routes real invoice.paid events through applyStripePaidInvoice.
  data.orders.push({ id: "o-legacy", userId: USER_ID, planId: PLAN_ID, quoteId: "q-legacy", amountMinor: 4900, currency: "usd", status: "paid", paymentMode: "stripe", kind: "purchase", stripeSubscriptionId: STRIPE_SUBSCRIPTION_ID, createdAt: iso(-200 * DAY) });
  data.subscriptions.push({ id: SUBSCRIPTION_ID, userId: USER_ID, planId: PLAN_ID, courseId: COURSE_ID, state: "active", source: "purchase", validFrom: iso(-200 * DAY), validTo: iso(-10 * DAY), cancelAtPeriodEnd: false, scope: "course", scopeId: COURSE_ID, device: "pc", stripeSubscriptionId: STRIPE_SUBSCRIPTION_ID, stripeCustomerId: "cus_legacy_1" });
  data.entitlements.push({ id: "e-legacy", userId: USER_ID, courseId: COURSE_ID, state: "active", source: "purchase", validTo: iso(-10 * DAY), scope: "course", scopeId: COURSE_ID, device: "pc" });
  await writeProductData(data);

  // Control: the legacy marker selects applyStripePaidInvoice for real events.
  assert.equal(await store.isLegacyStripeSubscription(STRIPE_SUBSCRIPTION_ID), true, "control: an order without a price snapshot marks the subscription legacy");

  // Time passes beyond the period; any portal visit sweeps and persists expiry.
  await store.getLearningOverview(USER_ID);
  const swept = await store.readProductAggregate();
  assert.equal(swept.subscriptions.find((item) => item.id === SUBSCRIPTION_ID)?.state, "expired", "precondition: the sweep expires the subscription");
  assert.equal(swept.entitlements.find((item) => item.id === "e-legacy")?.state, "expired", "precondition: the sweep expires the entitlement");

  // The paid renewal arrives on the legacy invoice path.
  const periodEnd = iso(150 * DAY);
  await store.applyStripePaidInvoice({
    subscriptionId: STRIPE_SUBSCRIPTION_ID,
    invoiceId: "in_legacy_1",
    amountMinor: 4900,
    paymentIntentId: "pi_legacy_1",
    currentPeriodStart: now,
    currentPeriodEnd: periodEnd,
  });

  // The Subscription surface shows the delivered renewal.
  const overview = await store.getLearningOverview(USER_ID);
  const subscription = overview.subscriptions.find((item) => item.id === SUBSCRIPTION_ID);
  assert.equal(subscription?.state, "active", "control: the renewal revives the subscription");
  assert.equal(subscription?.validTo, periodEnd);

  // D3 — desired: the entitlement is revived with the same paid period, so course
  // access matches the Subscription surface; currently it stays expired and the
  // course is refused everywhere downstream (My Learning, Study Group dropdown).
  const check = await store.checkEntitlement(USER_ID, COURSE_ID);
  assert.equal(check.allowed, true, "D3: a paid legacy renewal must leave the entitlement alive, matching the Subscription surface");
  assert.equal(check.validTo, periodEnd);
});
