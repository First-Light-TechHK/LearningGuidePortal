// PostgreSQL Payment persistence proofs (production-persistence slice 2).
// Orders, quotes, subscriptions, entitlements and stripeEvents live in ONE
// aggregate (app_files row learning_guide/product.json) written by
// productTransactionRepository; duplicate identity is arbitrated by
// product_payment_keys UNIQUE (db/migrations/009, applied here — ensureSchema
// does not create it) and by the productTransaction advisory lock. Every race
// runs across two worker processes with per-worker cwds, so the LOCAL
// product.json.lock cannot mask the database; the parent process seeds state
// (its own cwd is a sandbox tmpdir for the same reason) and verifies the
// committed rows.
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureSchema, getPool } from "../../../services/persistence/db";
import type { VerifiedStripeEvent } from "../../../contracts/payment";
import { closePool, countScalar, requireDatabaseUrl, rows, runWorkers, workerResult } from "./harness";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PRODUCT_ROOT = path.resolve(HERE, "../../..");
const MIGRATION_009 = path.join(PRODUCT_ROOT, "db", "migrations", "009_product_payment_keys.sql");
const PAYMENT_WORKER_FILE = path.join(HERE, "paymentWorkers.ts");
const PLAN_ID = "epicureanism-pc-6";

// This process drives the same PostgreSQL-backed product store as the
// workers: pin the settings the store reads at first use. DATA_S3_BUCKET is a
// dummy — the aggregate path never touches S3 — and PAYMENT_MODE=demo keeps
// createQuote off any Stripe price lookup.
process.env.STORAGE_BACKEND = "postgresql";
process.env.DATA_S3_BUCKET = "lg-io-bucket";
process.env.PAYMENT_MODE = "demo";
process.env.APP_ENV = "DEV";

async function loadProductStore() {
  // Imported after process.env was pinned; the store reads it at first use.
  return import("../../../services/productStore");
}
type ProductStore = Awaited<ReturnType<typeof loadProductStore>>;

type Aggregate = {
  orders: Array<{ id: string; userId: string; planId: string; quoteId: string; kind?: string; paymentMode: string; status: string }>;
  subscriptions: Array<{ id: string; userId: string; planId: string; source: string; state: string; validTo: string; stripeSubscriptionId?: string | null }>;
  entitlements: Array<{ id: string; userId: string; state: string; source: string; validTo: string }>;
  stripeEvents: Array<{ id: string }>;
};

let sequence = 0;
function uniqueId(prefix: string) {
  sequence += 1;
  return `${prefix}-${Date.now()}-${sequence}`;
}

/** Materialise the aggregate exactly like a first boot, then register a fresh user. */
async function seedUser(store: ProductStore) {
  await store.readProductAggregate();
  const attempt = await store.registerUserAttempt({ email: `${uniqueId("io")}@example.test`, password: "Passw0rd!123", nickname: "IO Proof" });
  return attempt.user;
}

async function aggregate(): Promise<Aggregate> {
  const stored = await rows<{ content: string | null }>("SELECT content FROM app_files WHERE path = $1", ["learning_guide/product.json"]);
  assert.equal(stored.length, 1, "the product aggregate row must exist in app_files");
  const content = stored[0].content;
  assert.ok(content, "the product aggregate row must carry content");
  return JSON.parse(content) as Aggregate;
}

/** Common worker env: same storage backend, dummy bucket, local container TLS off. */
function paymentEnv(extra: Record<string, string>) {
  return {
    DATABASE_SSL: "0",
    DATA_S3_BUCKET: "lg-io-bucket",
    STORAGE_BACKEND: "postgresql",
    PAYMENT_MODE: "demo",
    APP_ENV: "DEV",
    ...extra
  };
}

/** The checkout-shaped event both racing deliveries send; the parent replays the identical object. */
function webhookEvent(input: { eventId: string; orderId: string; sessionId: string; subscriptionRef: string; periodStart: string; periodEnd: string }): VerifiedStripeEvent {
  return {
    id: input.eventId,
    type: "checkout.session.completed",
    action: "checkout",
    orderId: input.orderId,
    sessionId: input.sessionId,
    subscriptionId: input.subscriptionRef,
    customerId: `cus_${input.eventId}`,
    paymentIntentId: `pi_${input.eventId}`,
    trial: false,
    subscriptionStatus: "active",
    cancelAtPeriodEnd: false,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd
  };
}

type WebhookResult = { role: string; duplicate: boolean; subscriptionId: string | null; entitlementId: string | null; validTo: string | null };

let sandboxDir = "";
let originalCwd = "";

before(async () => {
  requireDatabaseUrl();
  await ensureSchema();
  // product_payment_keys is NOT part of ensureSchema; the proof applies the
  // migration artifact itself, exactly like the deployment runbook does.
  await getPool().query(readFileSync(MIGRATION_009, "utf8"));
  // The store takes a LOCAL product.json.lock before the database transaction;
  // give this process its own sandbox cwd so that lock never contends with the
  // workers or the repository working tree.
  sandboxDir = mkdtempSync(path.join(tmpdir(), "lg-io-parent-"));
  mkdirSync(path.join(sandboxDir, "data", "knowledge_system", "learning_guide"), { recursive: true });
  originalCwd = process.cwd();
  process.chdir(sandboxDir);
});

after(async () => {
  try {
    process.chdir(originalCwd);
  } catch {
    // A vanished original directory must not mask a failing proof.
  }
  if (sandboxDir) rmSync(sandboxDir, { recursive: true, force: true });
  await closePool();
});

beforeEach(async () => {
  await getPool().query("TRUNCATE app_files, orm_rows, product_payment_keys, data_migrations RESTART IDENTITY CASCADE");
});

test("two processes delivering the same Stripe webhook event apply it once", async () => {
  const store = await loadProductStore();
  const user = await seedUser(store);
  const order = await store.createPendingStripeTrialOrder(user.id, PLAN_ID);
  const sessionId = uniqueId("cs");
  const eventId = uniqueId("evt");
  const subscriptionRef = uniqueId("sub");
  const periodStart = "2026-10-11T02:00:00.000Z";
  const periodEnd = "2027-04-11T02:00:00.000Z";
  await store.attachStripeCheckoutSession(user.id, order.order.id, sessionId);

  const outcomes = await runWorkers([
    { mode: "payment-webhook-event", env: paymentEnv({ LG_IO_EVENT_ID: eventId, LG_IO_ORDER: order.order.id, LG_IO_SESSION: sessionId, LG_IO_SUBSCRIPTION: subscriptionRef, LG_IO_TRIAL: "0", LG_IO_PERIOD_START: periodStart, LG_IO_PERIOD_END: periodEnd }) },
    { mode: "payment-webhook-event", env: paymentEnv({ LG_IO_EVENT_ID: eventId, LG_IO_ORDER: order.order.id, LG_IO_SESSION: sessionId, LG_IO_SUBSCRIPTION: subscriptionRef, LG_IO_TRIAL: "0", LG_IO_PERIOD_START: periodStart, LG_IO_PERIOD_END: periodEnd }) }
  ], { workerFile: PAYMENT_WORKER_FILE, perWorkerCwd: true });
  assert.equal(outcomes.length, 2, "both delivery processes must be accounted for");
  for (const outcome of outcomes) {
    assert.equal(outcome.exitCode, 0, `delivery ${outcome.role} must exit 0 (signal=${outcome.signal})\nstderr: ${outcome.stderr}`);
  }
  const results = outcomes.map((outcome) => workerResult<WebhookResult>(outcome));
  assert.equal(results.filter((result) => result.duplicate === false).length, 1, "exactly ONE delivery applies the webhook event");
  assert.equal(results.filter((result) => result.duplicate === true).length, 1, "the concurrent delivery must be deduplicated");
  assert.ok(results[0].subscriptionId, "the applied event must surface the subscription id");
  assert.equal(results[0].subscriptionId, results[1].subscriptionId, "both deliveries observe the SAME subscription");
  assert.ok(results[0].entitlementId, "the applied event must surface the entitlement id");
  assert.equal(results[0].entitlementId, results[1].entitlementId, "both deliveries observe the SAME entitlement");
  assert.equal(results[0].validTo, periodEnd, "the subscription entitlement keeps the checkout period end");
  assert.equal(results[1].validTo, periodEnd, "the duplicate delivery reports the same period end");

  const data = await aggregate();
  assert.equal(data.stripeEvents.filter((event) => event.id === eventId).length, 1, "the aggregate records the event EXACTLY once");
  assert.equal(await countScalar("SELECT count(*) FROM product_payment_keys WHERE kind = 'event' AND external_id = $1", [eventId]), 1, "exactly one product_payment_keys event row");
  const storedOrder = data.orders.find((item) => item.id === order.order.id);
  assert.equal(storedOrder?.status, "paid", "the raced order must be paid");
  const subscriptions = data.subscriptions.filter((item) => item.userId === user.id && item.planId === PLAN_ID);
  assert.equal(subscriptions.length, 1, "exactly one subscription for user+plan");
  assert.equal(subscriptions[0].source, "purchase", "the checkout created the purchase subscription");
  const entitlements = data.entitlements.filter((item) => item.userId === user.id && item.state === "active");
  assert.equal(entitlements.length, 1, "exactly one ACTIVE entitlement for user+plan");
  assert.equal(entitlements[0].validTo, periodEnd, "the entitlement validTo is the checkout period end");
  assert.equal(await countScalar("SELECT count(*) FROM orm_rows WHERE table_name = 'orders' AND id = $1 AND payload->>'status' = 'paid'", [order.order.id]), 1, "orm_rows mirrors the paid order");
  assert.equal(await countScalar("SELECT count(*) FROM orm_rows WHERE table_name = 'subscriptions' AND payload->>'userId' = $1 AND payload->>'source' = 'purchase'", [user.id]), 1, "orm_rows mirrors exactly one purchase subscription");
  assert.equal(await countScalar("SELECT count(*) FROM orm_rows WHERE table_name = 'entitlements' AND payload->>'userId' = $1 AND payload->>'state' = 'active'", [user.id]), 1, "orm_rows mirrors exactly one active entitlement");

  // Third, sequential redelivery inside this process: still a duplicate, and
  // nothing moves — no second subscription, no extended access.
  const third = await store.applyVerifiedStripeEvent(webhookEvent({ eventId, orderId: order.order.id, sessionId, subscriptionRef, periodStart, periodEnd }));
  assert.equal(third.duplicate, true, "a later redelivery must still be a duplicate");
  const after3 = await aggregate();
  assert.equal(after3.stripeEvents.filter((event) => event.id === eventId).length, 1, "redelivery must not record the event again");
  assert.equal(await countScalar("SELECT count(*) FROM product_payment_keys WHERE kind = 'event' AND external_id = $1", [eventId]), 1, "redelivery must not add a payment key");
  assert.equal(after3.subscriptions.filter((item) => item.userId === user.id && item.planId === PLAN_ID).length, 1, "redelivery must not add a subscription");
  const entitlementsAfter = after3.entitlements.filter((item) => item.userId === user.id && item.state === "active");
  assert.equal(entitlementsAfter.length, 1, "redelivery must not add an entitlement");
  assert.equal(entitlementsAfter[0].validTo, periodEnd, "redelivery must not change the entitlement validTo");
});

test("two processes completing the same demo order return one subscription and one entitlement", async () => {
  const store = await loadProductStore();
  const user = await seedUser(store);
  const quote = await store.createQuote(user.id, PLAN_ID, "purchase");
  const demo = await store.createPendingDemoOrder(user.id, quote.quote.id);

  const outcomes = await runWorkers([
    { mode: "payment-complete-demo", env: paymentEnv({ LG_IO_USER: user.id, LG_IO_ORDER: demo.order.id }) },
    { mode: "payment-complete-demo", env: paymentEnv({ LG_IO_USER: user.id, LG_IO_ORDER: demo.order.id }) }
  ], { workerFile: PAYMENT_WORKER_FILE, perWorkerCwd: true });
  const results = outcomes.map((outcome) => workerResult<{ orderStatus: string; subscriptionId: string; entitlementId: string; validTo: string }>(outcome));
  assert.equal(results[0].orderStatus, "paid", "the demo order must end paid");
  assert.equal(results[1].orderStatus, "paid", "the demo order must end paid for both processes");
  assert.equal(results[0].subscriptionId, results[1].subscriptionId, "both processes must return the SAME subscription id");
  assert.equal(results[0].entitlementId, results[1].entitlementId, "both processes must return the SAME entitlement id");
  assert.equal(results[0].validTo, results[1].validTo, "both processes must agree on the entitlement validTo");

  const data = await aggregate();
  assert.equal(data.orders.find((item) => item.id === demo.order.id)?.status, "paid", "the aggregate order must be paid");
  assert.equal(data.subscriptions.filter((item) => item.userId === user.id && item.planId === PLAN_ID).length, 1, "the aggregate must hold exactly one subscription");
  assert.equal(data.entitlements.filter((item) => item.userId === user.id && item.state === "active").length, 1, "the aggregate must hold exactly one ACTIVE entitlement");
  assert.equal(await countScalar("SELECT count(*) FROM orm_rows WHERE table_name = 'subscriptions' AND payload->>'userId' = $1", [user.id]), 1, "orm_rows mirrors exactly one subscription row");
  assert.equal(await countScalar("SELECT count(*) FROM orm_rows WHERE table_name = 'entitlements' AND payload->>'userId' = $1 AND payload->>'state' = 'active'", [user.id]), 1, "orm_rows mirrors exactly one active entitlement row");
});

test("two processes placing an order from the same quote create one order", async () => {
  const store = await loadProductStore();
  const user = await seedUser(store);
  const quote = await store.createQuote(user.id, PLAN_ID, "purchase");

  const outcomes = await runWorkers([
    { mode: "payment-create-order", env: paymentEnv({ LG_IO_USER: user.id, LG_IO_QUOTE: quote.quote.id }) },
    { mode: "payment-create-order", env: paymentEnv({ LG_IO_USER: user.id, LG_IO_QUOTE: quote.quote.id }) }
  ], { workerFile: PAYMENT_WORKER_FILE, perWorkerCwd: true });
  const results = outcomes.map((outcome) => workerResult<{ orderId: string }>(outcome));
  assert.ok(results[0].orderId, "the first process must return an order id");
  assert.equal(results[0].orderId, results[1].orderId, "both processes must return the SAME order id");

  assert.equal(await countScalar("SELECT count(*) FROM orm_rows WHERE table_name = 'orders' AND payload->>'quoteId' = $1", [quote.quote.id]), 1, "exactly one order row for the quote");
  const data = await aggregate();
  assert.equal(data.orders.filter((item) => item.quoteId === quote.quote.id).length, 1, "the aggregate must hold exactly one order for the quote");
});
