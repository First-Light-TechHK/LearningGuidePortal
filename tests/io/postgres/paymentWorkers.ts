// Worker process entry for the Payment PostgreSQL io proofs. The parent
// harness spawns this file once per role with a shared barrier, a per-worker
// cwd and the PostgreSQL backend forced on; every worker builds its own
// productStore view over its own pool, so only the database (the
// productTransaction advisory lock plus product_payment_keys UNIQUE) can
// arbitrate the race. The operation result is printed as one LG_IO_RESULT line.
//
// productStore is imported dynamically after the environment was read: the
// store evaluates storage/payment settings from process.env at first use, and
// the spawn env must already be in place.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getPool } from "../../../services/persistence/db";
import type { VerifiedStripeEvent } from "../../../contracts/payment";

const MODE = process.env.LG_IO_MODE || "";
const ROLE = process.env.LG_IO_ROLE || "A";
const BARRIER_DIR = process.env.LG_IO_BARRIER_DIR || "";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForGo() {
  mkdirSync(BARRIER_DIR, { recursive: true });
  writeFileSync(path.join(BARRIER_DIR, `${ROLE}.ready`), `${process.pid}\n`);
  const started = Date.now();
  while (!existsSync(path.join(BARRIER_DIR, "go"))) {
    if (Date.now() - started > 20_000) throw new Error("barrier timeout");
    await sleep(5);
  }
}

// The checkout-shaped event both racing deliveries send. LG_IO_TRIAL defaults
// to "0" so the accepted delivery creates a PURCHASE subscription (the trial
// variant only changes subscription.source in the aggregate).
function checkoutEvent(): VerifiedStripeEvent {
  const eventId = required("LG_IO_EVENT_ID");
  const trial = process.env.LG_IO_TRIAL === "1";
  return {
    id: eventId,
    type: "checkout.session.completed",
    action: "checkout",
    orderId: required("LG_IO_ORDER"),
    sessionId: required("LG_IO_SESSION"),
    subscriptionId: required("LG_IO_SUBSCRIPTION"),
    customerId: process.env.LG_IO_CUSTOMER || `cus_${eventId}`,
    paymentIntentId: process.env.LG_IO_PAYMENT_INTENT || `pi_${eventId}`,
    trial,
    subscriptionStatus: process.env.LG_IO_SUB_STATUS || (trial ? "trialing" : "active"),
    cancelAtPeriodEnd: false,
    periodStart: required("LG_IO_PERIOD_START"),
    periodEnd: required("LG_IO_PERIOD_END")
  };
}

// The renewal-invoice delivery shape the ORDER-02 proof sends: a
// subscription_cycle invoice.paid for the subscription the checkout created.
// Only used when LG_IO_INVOICE is set; the checkout shapes above keep their
// exact behaviour.
function invoiceEvent(): VerifiedStripeEvent {
  const eventId = required("LG_IO_EVENT_ID");
  return {
    id: eventId,
    type: "invoice.paid",
    action: "invoice",
    subscriptionId: required("LG_IO_SUBSCRIPTION"),
    invoiceId: required("LG_IO_INVOICE"),
    amountMinor: Number(process.env.LG_IO_AMOUNT_MINOR || "4900"),
    currency: "usd",
    status: "paid",
    billingReason: process.env.LG_IO_BILLING_REASON || "subscription_cycle",
    subscriptionStatus: process.env.LG_IO_SUB_STATUS || "active",
    cancelAtPeriodEnd: false,
    paymentIntentId: process.env.LG_IO_PAYMENT_INTENT || `pi_${eventId}`,
    periodStart: required("LG_IO_PERIOD_START"),
    periodEnd: required("LG_IO_PERIOD_END")
  };
}

/** Mirror of productStore's internal scopedValue, for re-reading the granted entitlement. */
function scopeOf(item: { courseId: string; scope?: string | null; scopeId?: string | null }) {
  if (item.scope === "category") return `category:${item.scopeId || ""}`;
  if (item.scope === "everything" || item.courseId === "*") return "everything:*";
  return `course:${item.scopeId || item.courseId}`;
}

async function main(): Promise<Record<string, unknown>> {
  if (!process.env.DATABASE_URL?.trim()) throw new Error("DATABASE_URL is not set for the worker");
  const store = await import("../../../services/productStore");
  await waitForGo();

  switch (MODE) {
    case "payment-webhook-event": {
      if (process.env.LG_IO_INVOICE) {
        const event = invoiceEvent();
        const outcome = await store.applyVerifiedStripeEvent(event);
        // Re-read the committed aggregate: the ORDER-02 proof asserts the
        // renewal order is durably recorded while access stays off.
        const data = await store.readProductAggregate();
        const subscription = data.subscriptions.find((item) => item.stripeSubscriptionId === event.subscriptionId);
        const renewalOrder = data.orders.find((item) => item.stripeInvoiceId === event.invoiceId);
        const entitlement = subscription
          ? data.entitlements.find((item) => item.userId === subscription.userId && item.source === subscription.source && scopeOf(item) === scopeOf(subscription))
          : undefined;
        return {
          role: ROLE,
          duplicate: outcome.duplicate,
          renewalOrderId: renewalOrder?.id ?? null,
          subscriptionState: subscription?.state ?? null,
          entitlementState: entitlement?.state ?? null
        };
      }
      const event = checkoutEvent();
      const outcome = await store.applyVerifiedStripeEvent(event);
      // Re-read the committed aggregate so every delivery reports the SAME
      // identity the accepted one created (O_CREAT lock files live in each
      // worker's own cwd, so nothing here is masked by a local lock).
      const data = await store.readProductAggregate();
      const order = data.orders.find((item) => item.id === event.orderId);
      const subscription = data.subscriptions.find((item) => item.stripeSubscriptionId === event.subscriptionId && item.state !== "expired")
        ?? data.subscriptions.find((item) => item.stripeSubscriptionId === event.subscriptionId);
      const plan = order ? order.planSnapshot || data.plans.find((item) => item.id === order.planId) : undefined;
      const entitlement = order && subscription && plan
        ? data.entitlements.find((item) => item.userId === order.userId && item.state === "active" && item.source === subscription.source && scopeOf(item) === scopeOf(plan))
        : undefined;
      return {
        role: ROLE,
        duplicate: outcome.duplicate,
        subscriptionId: subscription?.id ?? null,
        entitlementId: entitlement?.id ?? null,
        validTo: entitlement?.validTo ?? null
      };
    }
    case "payment-refund": {
      // Operator refund of one paid order (the same callable the spike used).
      // Re-read the committed aggregate so the reported status is the durable
      // one, not just the returned in-memory object.
      const refunded = await store.refundOrder(required("LG_IO_ORDER"), process.env.LG_IO_OPERATOR || "io-operator", null, process.env.LG_IO_REASON || null);
      const data = await store.readProductAggregate();
      const order = data.orders.find((item) => item.id === refunded.id);
      return { role: ROLE, orderId: refunded.id, orderStatus: order?.status ?? refunded.status };
    }
    case "payment-complete-demo": {
      const result = await store.completeDemoOrder(required("LG_IO_USER"), required("LG_IO_ORDER"));
      return {
        role: ROLE,
        orderStatus: result.order.status,
        subscriptionId: result.subscription.id,
        entitlementId: result.entitlement.id,
        validTo: result.entitlement.validTo
      };
    }
    case "payment-start-trial": {
      // The realistic single request path in ONE process: POST /api/trial
      // creates (or reuses) the pending demo trial order, then the demo
      // confirm completes it — createPendingDemoTrialOrder + completeDemoTrialOrder,
      // mirroring the spike's start-trial mode (order kind "trial_activation").
      const userId = required("LG_IO_USER");
      const planId = required("LG_IO_PLAN");
      const pending = await store.createPendingDemoTrialOrder(userId, planId);
      const done = await store.completeDemoTrialOrder(userId, pending.order.id);
      // Re-read the committed aggregate so every process reports the identity
      // and validTo the ONE grant produced.
      const data = await store.readProductAggregate();
      const order = data.orders.find((item) => item.id === done.order.id);
      const subscription = data.subscriptions.find((item) => item.id === done.subscription.id);
      const entitlement = done.entitlement ? data.entitlements.find((item) => item.id === done.entitlement?.id) : undefined;
      if (!order || !subscription || !entitlement) throw new Error("the committed aggregate is missing the granted trial order, subscription or entitlement");
      return {
        role: ROLE,
        orderId: order.id,
        subscriptionId: subscription.id,
        entitlementId: entitlement.id,
        validTo: entitlement.validTo
      };
    }
    case "payment-create-order": {
      const result = await store.createPendingDemoOrder(required("LG_IO_USER"), required("LG_IO_QUOTE"));
      return { role: ROLE, orderId: result.order.id };
    }
    default:
      throw new Error(`unknown LG_IO_MODE ${MODE}`);
  }
}

main()
  .then(async (result) => {
    console.log(`LG_IO_RESULT ${JSON.stringify(result)}`);
    await getPool().end();
  })
  .catch(async (error) => {
    console.error(error);
    try {
      await getPool().end();
    } catch {
      // The pool may never have connected.
    }
    process.exit(1);
  });
