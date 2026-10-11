// PostgreSQL Visitor / Trial persistence proofs (production-persistence slice 2).
// The visitor trial start is the realistic single request path —
// createPendingDemoTrialOrder then completeDemoTrialOrder (order kind
// "trial_activation", productStore) — run inside worker processes whose cwds
// are per-worker tmp directories, so the LOCAL product.json.lock cannot mask
// the database: only the productTransaction advisory lock (719301, 1) over the
// app_files learning_guide/product.json aggregate can arbitrate the race. The
// parent process seeds state in its own sandbox cwd and verifies the committed
// aggregate (app_files) plus the orm_rows mirror.
//
// TRIAL-01/02 (INV-one-charge): two processes starting the same trial must
// grant ONE trial; a settled/redelivered trial start must not extend validTo;
// and a trial start after a paid purchase must not grant a second entitlement
// (the product refuses with "This plan already has active access.", the 400
// the file-store visitor-trial proof asserts).
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

// The demo trial grants three days: services/productStore.ts TRIAL_DAYS = 3
// (grantTrialAccess sets validTo = grant instant + 3 days), agreeing with the
// file-store io harness constant TRIAL_MS.
const TRIAL_MS = 3 * 24 * 60 * 60 * 1000;

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
  subscriptions: Array<{ id: string; userId: string; planId: string; source: string; state: string; validTo: string }>;
  entitlements: Array<{ id: string; userId: string; state: string; source: string; validTo: string }>;
};

type TrialResult = { role: string; orderId: string; subscriptionId: string; entitlementId: string; validTo: string };

let sequence = 0;
function uniqueId(prefix: string) {
  sequence += 1;
  return `${prefix}-${Date.now()}-${sequence}`;
}

/** Materialise the aggregate exactly like a first boot, then register a fresh user. */
async function seedUser(store: ProductStore) {
  await store.readProductAggregate();
  const attempt = await store.registerUserAttempt({ email: `${uniqueId("io")}@example.test`, password: "Passw0rd!123", nickname: "IO Trial Proof" });
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

/** One trial-start worker spec per copy: the same user+plan, create-then-complete in-process. */
function trialSpecs(userId: string, count: number) {
  return Array.from({ length: count }, () => ({
    mode: "payment-start-trial",
    env: paymentEnv({ LG_IO_USER: userId, LG_IO_PLAN: PLAN_ID })
  }));
}

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

test("TRIAL-01/02 race (INV-one-charge): two processes starting the same trial grant one trial", async () => {
  const store = await loadProductStore();
  const user = await seedUser(store);
  const before = Date.now();

  const outcomes = await runWorkers(trialSpecs(user.id, 2), { workerFile: PAYMENT_WORKER_FILE, perWorkerCwd: true });
  assert.equal(outcomes.length, 2, "both trial-start processes must be accounted for");
  for (const outcome of outcomes) {
    assert.equal(outcome.exitCode, 0, `trial start ${outcome.role} must exit 0 (signal=${outcome.signal})\nstderr: ${outcome.stderr}`);
  }
  const results = outcomes.map((outcome) => workerResult<TrialResult>(outcome));
  assert.ok(results[0].orderId, "the trial start must surface the order id");
  assert.equal(results[0].orderId, results[1].orderId, "both processes must return the SAME trial order id");
  assert.ok(results[0].subscriptionId, "the trial start must surface the subscription id");
  assert.equal(results[0].subscriptionId, results[1].subscriptionId, "both processes must return the SAME subscription id");
  assert.equal(results[0].entitlementId, results[1].entitlementId, "both processes must return the SAME entitlement id");
  assert.equal(results[0].validTo, results[1].validTo, "both processes must agree on the trial validTo");

  // The trial window: three days from the grant instant, tolerant of the
  // spawn latency between this timestamp and the grant (like the io proofs).
  const validToMs = Date.parse(results[0].validTo);
  assert.ok(Number.isFinite(validToMs), "validTo must be a parseable instant");
  assert.ok(validToMs >= before, "the trial cannot end before the run began");
  assert.ok(validToMs <= before + TRIAL_MS + 60_000, "validTo must stay inside the three-day trial window");
  assert.ok(validToMs < before + 30 * 24 * 60 * 60 * 1000, "validTo must not read as a full-term purchase");

  const data = await aggregate();
  const trialOrders = data.orders.filter((item) => item.userId === user.id && item.kind === "trial_activation");
  assert.equal(trialOrders.length, 1, "the aggregate must hold EXACTLY one trial_activation order");
  assert.equal(trialOrders[0].id, results[0].orderId, "the aggregate's trial order is the one both processes reported");
  assert.equal(trialOrders[0].status, "paid", "the raced trial order must settle paid");
  const subscriptions = data.subscriptions.filter((item) => item.userId === user.id && item.planId === PLAN_ID);
  assert.equal(subscriptions.length, 1, "the aggregate must hold EXACTLY one subscription for user+plan");
  assert.equal(subscriptions[0].source, "trial", "the single subscription is the trial source");
  assert.equal(subscriptions[0].id, results[0].subscriptionId, "the aggregate subscription is the one both processes reported");
  const entitlements = data.entitlements.filter((item) => item.userId === user.id && item.state === "active");
  assert.equal(entitlements.length, 1, "the aggregate must hold EXACTLY one ACTIVE entitlement");
  assert.equal(entitlements[0].source, "trial", "the active entitlement is the trial source");
  assert.equal(entitlements[0].id, results[0].entitlementId, "the aggregate entitlement is the one both processes reported");
  assert.equal(entitlements[0].validTo, results[0].validTo, "the aggregate entitlement keeps the reported validTo");

  assert.equal(await countScalar("SELECT count(*) FROM orm_rows WHERE table_name = 'orders' AND payload->>'userId' = $1 AND payload->>'kind' = 'trial_activation'", [user.id]), 1, "orm_rows mirrors exactly one trial_activation order");
  assert.equal(await countScalar("SELECT count(*) FROM orm_rows WHERE table_name = 'orders' AND payload->>'userId' = $1 AND payload->>'kind' = 'trial_activation' AND payload->>'status' = 'paid'", [user.id]), 1, "orm_rows mirrors the trial order as paid");
  assert.equal(await countScalar("SELECT count(*) FROM orm_rows WHERE table_name = 'subscriptions' AND payload->>'userId' = $1 AND payload->>'source' = 'trial'", [user.id]), 1, "orm_rows mirrors exactly one trial subscription");
  assert.equal(await countScalar("SELECT count(*) FROM orm_rows WHERE table_name = 'entitlements' AND payload->>'userId' = $1 AND payload->>'state' = 'active'", [user.id]), 1, "orm_rows mirrors exactly one active entitlement");
});

test("TRIAL-01 redelivery: a settled trial start cannot extend or duplicate", async () => {
  const store = await loadProductStore();
  const user = await seedUser(store);

  const first = await runWorkers(trialSpecs(user.id, 1), { workerFile: PAYMENT_WORKER_FILE, perWorkerCwd: true });
  assert.equal(first[0].exitCode, 0, `the settling trial start must exit 0 (signal=${first[0].signal})\nstderr: ${first[0].stderr}`);
  const settled = workerResult<TrialResult>(first[0]);

  // A later, sequential redelivery of the same request path: the create step
  // dedupes by user+plan (pending/paid trial_activation order) and the
  // complete step hands back the SAME trial pair.
  const again = await runWorkers(trialSpecs(user.id, 1), { workerFile: PAYMENT_WORKER_FILE, perWorkerCwd: true });
  assert.equal(again[0].exitCode, 0, `the redelivery must exit 0 (signal=${again[0].signal})\nstderr: ${again[0].stderr}`);
  const redelivered = workerResult<TrialResult>(again[0]);
  assert.equal(redelivered.orderId, settled.orderId, "the redelivery must reuse the settled trial order");
  assert.equal(redelivered.subscriptionId, settled.subscriptionId, "the redelivery must reuse the settled subscription");
  assert.equal(redelivered.entitlementId, settled.entitlementId, "the redelivery must reuse the settled entitlement");
  assert.equal(redelivered.validTo, settled.validTo, "the redelivery must NOT extend the trial validTo");

  const data = await aggregate();
  assert.equal(data.orders.filter((item) => item.userId === user.id && item.kind === "trial_activation").length, 1, "still exactly one trial_activation order");
  assert.equal(data.subscriptions.filter((item) => item.userId === user.id && item.planId === PLAN_ID).length, 1, "still exactly one subscription for user+plan");
  const entitlements = data.entitlements.filter((item) => item.userId === user.id && item.state === "active");
  assert.equal(entitlements.length, 1, "still exactly one ACTIVE entitlement");
  assert.equal(entitlements[0].validTo, settled.validTo, "the settled validTo is unchanged");
  assert.equal(await countScalar("SELECT count(*) FROM orm_rows WHERE table_name = 'orders' AND payload->>'userId' = $1 AND payload->>'kind' = 'trial_activation'", [user.id]), 1, "orm_rows still mirrors exactly one trial_activation order");
});

test("TRIAL-02: a second trial after a paid purchase does not grant", async () => {
  const store = await loadProductStore();
  const user = await seedUser(store);
  // Give the user a PAID purchase with the payment proof's exact demo seeding:
  // purchase quote + pending demo order, settled by completeDemoOrder.
  const quote = await store.createQuote(user.id, PLAN_ID, "purchase");
  const demo = await store.createPendingDemoOrder(user.id, quote.quote.id);
  const paid = await store.completeDemoOrder(user.id, demo.order.id);
  assert.equal(paid.order.status, "paid", "the seeded purchase must settle paid");
  const purchaseEntitlementId = paid.entitlement.id;
  const purchaseValidTo = paid.entitlement.validTo;

  // The product's TRIAL-02 contract: a trial start while a paid purchase is
  // active is REFUSED — createPendingDemoTrialOrder throws "This plan already
  // has active access." (the 400 the file-store visitor-trial proof asserts);
  // across the worker boundary that refusal is a non-zero exit carrying the
  // same message.
  await assert.rejects(
    runWorkers(trialSpecs(user.id, 1), { workerFile: PAYMENT_WORKER_FILE, perWorkerCwd: true }),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      assert.match(message, /already has active access/i, "the refusal must carry the product's TRIAL-02 message");
      assert.match(message, /exit=1/, "the worker must FAIL rather than return a granted trial");
      return true;
    }
  );

  const data = await aggregate();
  assert.equal(data.orders.filter((item) => item.userId === user.id && item.kind === "trial_activation").length, 0, "the refused trial must not leave a trial_activation order");
  const subscriptions = data.subscriptions.filter((item) => item.userId === user.id && item.planId === PLAN_ID);
  assert.equal(subscriptions.length, 1, "still exactly one subscription for user+plan");
  assert.equal(subscriptions[0].source, "purchase", "the single subscription is the paid purchase");
  const entitlements = data.entitlements.filter((item) => item.userId === user.id && item.state === "active");
  assert.equal(entitlements.length, 1, "still exactly one ACTIVE entitlement");
  assert.equal(entitlements[0].id, purchaseEntitlementId, "the active entitlement is the purchased one");
  assert.equal(entitlements[0].validTo, purchaseValidTo, "the paid entitlement validTo is unchanged (no extension)");
  assert.equal(await countScalar("SELECT count(*) FROM orm_rows WHERE table_name = 'orders' AND payload->>'userId' = $1 AND payload->>'kind' = 'trial_activation'", [user.id]), 0, "orm_rows holds no trial_activation order");
  assert.equal(await countScalar("SELECT count(*) FROM orm_rows WHERE table_name = 'subscriptions' AND payload->>'userId' = $1 AND payload->>'source' = 'trial'", [user.id]), 0, "orm_rows holds no trial subscription");
  assert.equal(await countScalar("SELECT count(*) FROM orm_rows WHERE table_name = 'entitlements' AND payload->>'userId' = $1 AND payload->>'state' = 'active'", [user.id]), 1, "orm_rows still holds exactly one active entitlement");
});
