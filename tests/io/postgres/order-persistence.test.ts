// PostgreSQL ORDER-02 proofs: "Operator refund then later invoice.paid must
// not revive". The unit lock (tests/unit/refund-then-invoice.test.ts) proves
// the service contract on the file store; these proofs run the same delivery
// shapes through worker processes against the PostgreSQL-backed store, where
// the productTransaction advisory lock serializes the aggregate writes and
// product_payment_keys UNIQUE (db/migrations/009, applied here — ensureSchema
// does not create it) arbitrates duplicate identity. The refund runs in its
// own process through the payment-refund worker (the same refundOrder callable
// the spike used); every race uses per-worker cwds so the LOCAL
// product.json.lock cannot mask the database.
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureSchema, getPool } from "../../../services/persistence/db";
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
  orders: Array<{ id: string; userId: string; planId: string; quoteId: string; kind?: string; paymentMode: string; status: string; stripeInvoiceId?: string | null; stripeSubscriptionId?: string | null }>;
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
  const attempt = await store.registerUserAttempt({ email: `${uniqueId("io")}@example.test`, password: "Passw0rd!123", nickname: "Order Proof" });
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

/** The checkout delivery that completes the pending Stripe order (payment proof shape). */
function checkoutEnv(input: { eventId: string; orderId: string; sessionId: string; subscriptionRef: string; periodStart: string; periodEnd: string }) {
  return paymentEnv({
    LG_IO_EVENT_ID: input.eventId,
    LG_IO_ORDER: input.orderId,
    LG_IO_SESSION: input.sessionId,
    LG_IO_SUBSCRIPTION: input.subscriptionRef,
    LG_IO_TRIAL: "0",
    LG_IO_PERIOD_START: input.periodStart,
    LG_IO_PERIOD_END: input.periodEnd
  });
}

/** A renewal invoice.paid delivery for the same Stripe subscription (new invoice id). */
function renewalEnv(input: { eventId: string; subscriptionRef: string; invoiceId: string; periodStart: string; periodEnd: string }) {
  return paymentEnv({
    LG_IO_EVENT_ID: input.eventId,
    LG_IO_SUBSCRIPTION: input.subscriptionRef,
    LG_IO_INVOICE: input.invoiceId,
    LG_IO_PERIOD_START: input.periodStart,
    LG_IO_PERIOD_END: input.periodEnd
  });
}

type CheckoutResult = { role: string; duplicate: boolean; subscriptionId: string | null; entitlementId: string | null; validTo: string | null };
type RenewalResult = { role: string; duplicate: boolean; renewalOrderId: string | null; subscriptionState: string | null; entitlementState: string | null };
type RefundResult = { role: string; orderId: string; orderStatus: string };

const CHECKOUT_START = "2026-10-11T02:00:00.000Z";
const CHECKOUT_END = "2027-04-11T02:00:00.000Z";
const RENEWAL_END = "2027-05-11T02:00:00.000Z";

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

/** Seed a paid purchase through the checkout worker, exactly like the payment proof. */
async function seedPaidPurchase(store: ProductStore) {
  const user = await seedUser(store);
  const order = await store.createPendingStripeTrialOrder(user.id, PLAN_ID);
  const sessionId = uniqueId("cs");
  const subscriptionRef = uniqueId("sub");
  await store.attachStripeCheckoutSession(user.id, order.order.id, sessionId);
  const outcomes = await runWorkers([
    { mode: "payment-webhook-event", env: checkoutEnv({ eventId: uniqueId("evt"), orderId: order.order.id, sessionId, subscriptionRef, periodStart: CHECKOUT_START, periodEnd: CHECKOUT_END }) }
  ], { workerFile: PAYMENT_WORKER_FILE, perWorkerCwd: true });
  const granted = workerResult<CheckoutResult>(outcomes[0]);
  assert.equal(granted.duplicate, false, "the checkout delivery must apply");
  assert.ok(granted.subscriptionId, "the checkout must create the purchase subscription");
  assert.ok(granted.entitlementId, "the checkout must grant the entitlement");
  assert.equal(granted.validTo, CHECKOUT_END, "the entitlement keeps the checkout period end");
  return { user, orderId: order.order.id, sessionId, subscriptionRef };
}

/** Assert the ORDER-02 end state: refunded order, no active access, money still recorded. */
async function assertNoRevival(input: { userId: string; orderId: string; subscriptionRef: string; recordedInvoiceIds: string[] }) {
  const data = await aggregate();
  assert.equal(data.orders.find((item) => item.id === input.orderId)?.status, "refunded", "the refunded order must stay refunded");
  assert.equal(data.orders.filter((item) => item.status === "refunded").length, 1, "exactly one refund must be recorded");
  const liveSubscriptions = data.subscriptions.filter((item) => item.stripeSubscriptionId === input.subscriptionRef && item.state !== "expired");
  assert.equal(liveSubscriptions.length, 0, "the subscription must stay non-active");
  assert.equal(data.entitlements.filter((item) => item.userId === input.userId && item.state === "active").length, 0, "no active entitlement may exist");
  assert.equal(data.entitlements.filter((item) => item.userId === input.userId && item.source === "purchase" && item.state === "revoked").length, 1, "the purchase entitlement ends revoked");
  for (const invoiceId of input.recordedInvoiceIds) {
    const recorded = data.orders.filter((item) => item.stripeInvoiceId === invoiceId);
    assert.equal(recorded.length, 1, `invoice ${invoiceId} is recorded exactly once`);
    assert.equal(recorded[0].status, "paid", `invoice ${invoiceId} keeps the paid money fact`);
  }
  return data;
}

test("operator refund then a renewal invoice.paid records the money but never revives access", async () => {
  const store = await loadProductStore();
  const seeded = await seedPaidPurchase(store);
  const paid = await aggregate();
  assert.equal(paid.orders.find((item) => item.id === seeded.orderId)?.status, "paid", "the checkout order must be paid before the refund");

  // Operator refund in its own process (the payment-refund worker).
  const refundOutcomes = await runWorkers([
    { mode: "payment-refund", env: paymentEnv({ LG_IO_ORDER: seeded.orderId }) }
  ], { workerFile: PAYMENT_WORKER_FILE, perWorkerCwd: true });
  const refund = workerResult<RefundResult>(refundOutcomes[0]);
  assert.equal(refund.orderId, seeded.orderId);
  assert.equal(refund.orderStatus, "refunded", "the refund worker must report the durable refunded status");

  const afterRefund = await aggregate();
  assert.equal(afterRefund.subscriptions.find((item) => item.stripeSubscriptionId === seeded.subscriptionRef)?.state, "expired", "the refund must expire the subscription");
  assert.equal(afterRefund.entitlements.filter((item) => item.userId === seeded.user.id && item.state === "active").length, 0, "the refund must revoke access");

  // A later renewal invoice.paid for the SAME subscription, new invoice id, extended period.
  const invoiceId = uniqueId("in");
  const renewalOutcomes = await runWorkers([
    { mode: "payment-webhook-event", env: renewalEnv({ eventId: uniqueId("evt"), subscriptionRef: seeded.subscriptionRef, invoiceId, periodStart: CHECKOUT_END, periodEnd: RENEWAL_END }) }
  ], { workerFile: PAYMENT_WORKER_FILE, perWorkerCwd: true });
  const renewal = workerResult<RenewalResult>(renewalOutcomes[0]);
  assert.equal(renewal.duplicate, false, "the renewal invoice must be processed, not deduplicated");
  assert.ok(renewal.renewalOrderId, "the renewal invoice must still be recorded as a paid order");
  assert.equal(renewal.subscriptionState, "expired", "the renewal invoice must not reactivate the subscription");
  assert.equal(renewal.entitlementState, "revoked", "the renewal invoice must not flip the revoked entitlement back");

  const afterRenewal = await assertNoRevival({ userId: seeded.user.id, orderId: seeded.orderId, subscriptionRef: seeded.subscriptionRef, recordedInvoiceIds: [invoiceId] });

  // orm_rows mirrors the durable rows the payment proofs assert on.
  assert.equal(await countScalar("SELECT count(*) FROM orm_rows WHERE table_name = 'orders' AND id = $1 AND payload->>'status' = 'refunded'", [seeded.orderId]), 1, "orm_rows mirrors the refunded order");
  assert.equal(await countScalar("SELECT count(*) FROM orm_rows WHERE table_name = 'subscriptions' AND payload->>'stripeSubscriptionId' = $1 AND payload->>'state' = 'expired'", [seeded.subscriptionRef]), 1, "orm_rows mirrors the expired subscription");
  assert.equal(await countScalar("SELECT count(*) FROM orm_rows WHERE table_name = 'entitlements' AND payload->>'userId' = $1 AND payload->>'state' = 'active'", [seeded.user.id]), 0, "orm_rows mirrors no active entitlement");
  assert.equal(await countScalar("SELECT count(*) FROM orm_rows WHERE table_name = 'entitlements' AND payload->>'userId' = $1 AND payload->>'state' = 'revoked'", [seeded.user.id]), 1, "orm_rows mirrors the revoked entitlement");
  assert.equal(await countScalar("SELECT count(*) FROM product_payment_keys WHERE kind = 'invoice' AND external_id = $1", [invoiceId]), 1, "exactly one product_payment_keys invoice row");

  // A redelivery of the SAME invoice (new event id) records nothing new and never revives.
  const replayOutcomes = await runWorkers([
    { mode: "payment-webhook-event", env: renewalEnv({ eventId: uniqueId("evt"), subscriptionRef: seeded.subscriptionRef, invoiceId, periodStart: CHECKOUT_END, periodEnd: RENEWAL_END }) }
  ], { workerFile: PAYMENT_WORKER_FILE, perWorkerCwd: true });
  const replay = workerResult<RenewalResult>(replayOutcomes[0]);
  assert.equal(replay.duplicate, false, "the replayed invoice is a new event id and is processed");
  await assertNoRevival({ userId: seeded.user.id, orderId: seeded.orderId, subscriptionRef: seeded.subscriptionRef, recordedInvoiceIds: [invoiceId] });
  assert.equal((await aggregate()).stripeEvents.length, afterRenewal.stripeEvents.length + 1, "the replay records the event but no extra order");

  // A genuine SECOND renewal (new invoice id) is still recorded without revival.
  const secondInvoiceId = uniqueId("in");
  const secondOutcomes = await runWorkers([
    { mode: "payment-webhook-event", env: renewalEnv({ eventId: uniqueId("evt"), subscriptionRef: seeded.subscriptionRef, invoiceId: secondInvoiceId, periodStart: RENEWAL_END, periodEnd: "2027-06-11T02:00:00.000Z" }) }
  ], { workerFile: PAYMENT_WORKER_FILE, perWorkerCwd: true });
  const second = workerResult<RenewalResult>(secondOutcomes[0]);
  assert.equal(second.duplicate, false);
  assert.ok(second.renewalOrderId, "the second renewal is still recorded as a paid order");
  assert.equal(second.subscriptionState, "expired");
  assert.equal(second.entitlementState, "revoked");
  await assertNoRevival({ userId: seeded.user.id, orderId: seeded.orderId, subscriptionRef: seeded.subscriptionRef, recordedInvoiceIds: [invoiceId, secondInvoiceId] });
});

test("a refund racing a renewal invoice.paid converges on the same no-revival contract", async () => {
  const store = await loadProductStore();
  const seeded = await seedPaidPurchase(store);

  const invoiceId = uniqueId("in");
  const outcomes = await runWorkers([
    { mode: "payment-refund", env: paymentEnv({ LG_IO_ORDER: seeded.orderId }) },
    { mode: "payment-webhook-event", env: renewalEnv({ eventId: uniqueId("evt"), subscriptionRef: seeded.subscriptionRef, invoiceId, periodStart: CHECKOUT_END, periodEnd: RENEWAL_END }) }
  ], { workerFile: PAYMENT_WORKER_FILE, perWorkerCwd: true });
  assert.equal(outcomes.length, 2, "both racing processes must be accounted for");
  for (const outcome of outcomes) {
    assert.equal(outcome.exitCode, 0, `racing process ${outcome.role} (${outcome.mode}) must exit 0 (signal=${outcome.signal})\nstderr: ${outcome.stderr}`);
  }
  const refund = workerResult<RefundResult>(outcomes[0]);
  const renewal = workerResult<RenewalResult>(outcomes[1]);
  assert.equal(refund.orderStatus, "refunded", "the refund must commit regardless of order");
  assert.equal(renewal.duplicate, false, "the renewal delivery must be processed, not dropped");

  // EVERY interleaving ends here: the refund wins, but the invoice money is kept.
  const raced = await assertNoRevival({ userId: seeded.user.id, orderId: seeded.orderId, subscriptionRef: seeded.subscriptionRef, recordedInvoiceIds: [invoiceId] });
  assert.equal(await countScalar("SELECT count(*) FROM orm_rows WHERE table_name = 'orders' AND id = $1 AND payload->>'status' = 'refunded'", [seeded.orderId]), 1, "orm_rows mirrors the refunded order after the race");
  assert.equal(await countScalar("SELECT count(*) FROM orm_rows WHERE table_name = 'entitlements' AND payload->>'userId' = $1 AND payload->>'state' = 'active'", [seeded.user.id]), 0, "orm_rows mirrors no active entitlement after the race");
  assert.equal(await countScalar("SELECT count(*) FROM product_payment_keys WHERE kind = 'invoice' AND external_id = $1", [invoiceId]), 1, "exactly one product_payment_keys invoice row after the race");

  // A FOLLOW-UP renewal delivery after the race still does not revive.
  const followUpInvoiceId = uniqueId("in");
  const followUpOutcomes = await runWorkers([
    { mode: "payment-webhook-event", env: renewalEnv({ eventId: uniqueId("evt"), subscriptionRef: seeded.subscriptionRef, invoiceId: followUpInvoiceId, periodStart: RENEWAL_END, periodEnd: "2027-06-11T02:00:00.000Z" }) }
  ], { workerFile: PAYMENT_WORKER_FILE, perWorkerCwd: true });
  const followUp = workerResult<RenewalResult>(followUpOutcomes[0]);
  assert.equal(followUp.duplicate, false);
  assert.equal(followUp.subscriptionState, "expired", "a follow-up renewal after the race still must not reactivate the subscription");
  assert.equal(followUp.entitlementState, "revoked", "a follow-up renewal after the race still must not revive the entitlement");
  await assertNoRevival({ userId: seeded.user.id, orderId: seeded.orderId, subscriptionRef: seeded.subscriptionRef, recordedInvoiceIds: [invoiceId, followUpInvoiceId] });
  assert.equal(raced.orders.filter((item) => item.stripeInvoiceId === invoiceId).length, 1, "the raced invoice stays recorded exactly once");
});
