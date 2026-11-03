import type Stripe from "stripe";
import { OrderManagementError, type ManagedOrder, type OrderAction, type OrderActionResult, type PaymentReview } from "@/contracts/order-management";
import { getStripe } from "./stripeClient";
import { reconcileStripeCheckout } from "./stripeCheckoutPayment";
import { reconcileStripeUpgradeInvoice, validateInvoice } from "./stripeUpgradePayment";
import { getOrderForUser, listOrdersForUser, recordOrderPaymentReview, updateDemoOrderStatus, attachStripeUpgradeInvoice,
  type ProductOrder, type ProductPlan } from "./productStore";

type OwnedOrder = ProductOrder & { plan: ProductPlan | null };
const identity = (value: string | { id: string } | null | undefined) => typeof value === "string" ? value : value?.id;
const deadline = (seconds: number | null | undefined) => seconds && Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : null;
class IdentityMismatch extends Error {}

export function projectManagedOrder(order: OwnedOrder): ManagedOrder {
  const review = order.paymentReview;
  const state = order.status === "pending" ? review?.state || "unverified"
    : order.status === "canceled" && !order.cancellation && order.lastStripeStatus === "expired" ? "expired" : order.status;
  const actionable = order.status === "pending" && state === "awaiting_payment"
    && (!review?.expiresAt || Date.parse(review.expiresAt) > Date.now());
  return { id: order.id, name: order.price?.productName || order.plan?.name || order.planId,
    kind: order.kind || "purchase", status: order.status, state, amountMinor: order.amountMinor, currency: order.currency,
    termMonths: order.price?.termMonths || order.plan?.termMonths || null, createdAt: order.createdAt,
    expiresAt: order.status === "pending" ? review?.expiresAt || null : null, checkedAt: review?.checkedAt || order.lastSyncedAt || null,
    reason: order.status === "pending" ? review?.reason || null : null,
    canResume: actionable, canCancel: actionable };
}

export async function listManagedOrders(userId: string) {
  return (await listOrdersForUser(userId)).map(projectManagedOrder);
}

function hostedUrl(value: string | null | undefined, kind: "checkout" | "invoice") {
  if (!value) throw new IdentityMismatch();
  let url: URL;
  try { url = new URL(value); } catch { throw new IdentityMismatch(); }
  if (url.origin !== (kind === "checkout" ? "https://checkout.stripe.com" : "https://invoice.stripe.com") || url.username || url.password) throw new IdentityMismatch();
  return value;
}

function validateCheckout(order: OwnedOrder, session: Stripe.Checkout.Session) {
  const metadata = session.metadata;
  if (session.id !== order.stripeCheckoutSessionId || metadata?.app !== "learning_guide"
    || metadata.orderId !== order.id || metadata.userId !== order.userId || metadata.planId !== order.planId || metadata.quoteId !== order.quoteId
    || session.currency !== order.currency || session.amount_total !== order.amountMinor
    || session.mode !== (order.kind === "upgrade" ? "payment" : "subscription")) throw new IdentityMismatch();
  const price = order.kind === "upgrade" ? order.upgradePrice : order.price;
  const lines = session.line_items;
  if (!price || !lines || lines.has_more || lines.data.length !== 1 || lines.data[0].quantity !== 1 || lines.data[0].price?.id !== price.stripePriceId) throw new IdentityMismatch();
}

async function invoiceProcessing(invoiceId: string) {
  const stripe = getStripe();
  const payments = await stripe.invoicePayments.list({ invoice: invoiceId, limit: 10 });
  if (payments.has_more) throw new IdentityMismatch();
  const intents = payments.data.filter(payment => payment.status !== "canceled").map(payment => identity(payment.payment.payment_intent)).filter((id): id is string => Boolean(id));
  const states = await Promise.all(intents.map(id => stripe.paymentIntents.retrieve(id)));
  return states.some(payment => ["processing", "succeeded", "requires_capture"].includes(payment.status));
}

/** These actions always operate on the account-owned provider identity, never a Quote or client price. */
export async function manageOrderPayment(userId: string, orderId: string, action: OrderAction,
  options?: { locale?: "en-GB" | "zh-CN"; actor?: { id: string; role: "operator" } }): Promise<OrderActionResult> {
  const actor = options?.actor;
  let order = await getOrderForUser(userId, orderId);
  if (!order) throw new OrderManagementError("not_found", 404);
  if (order.status !== "pending") return { order: projectManagedOrder(order) };
  const review: PaymentReview = { state: "unavailable", checkedAt: new Date().toISOString(), expiresAt: null, providerStatus: null, reason: null };
  let checkoutUrl: string | undefined;
  let closureRequested = false;
  try {
    if (order.paymentMode === "demo") {
      if (action === "cancel") { closureRequested = true; await updateDemoOrderStatus(userId, orderId, "canceled", "customer_canceled"); }
      review.state = "awaiting_payment";
      review.providerStatus = "demo";
      if (action === "resume") checkoutUrl = `/${options?.locale === "zh-CN" ? "zh-CN" : "en-GB"}/portal/payment/checkout?orderId=${encodeURIComponent(order.id)}`;
    } else if (order.upgradeProration) {
      const stripe = getStripe(), snapshot = order.upgradeProration;
      const subscription = await stripe.subscriptions.retrieve(snapshot.subscriptionId);
      if (!subscription || subscription.id !== snapshot.subscriptionId || identity(subscription.customer) !== snapshot.customerId) throw new IdentityMismatch();
      let invoiceId = order.stripeInvoiceId;
      // Recover a response lost after Stripe created the upgrade Invoice. Never create another one.
      if (!invoiceId) {
        const candidateId = identity(subscription.latest_invoice);
        const candidate = candidateId ? await stripe.invoices.retrieve(candidateId) : null;
        if (candidate && candidate.created >= Math.floor(Date.parse(order.createdAt) / 1000)) {
          validateInvoice(candidate, snapshot);
          await attachStripeUpgradeInvoice(userId, orderId, candidate.id);
          invoiceId = candidate.id;
        }
      }
      if (!invoiceId) { review.reason = "missing_payment"; }
      else {
        let invoice = await stripe.invoices.retrieve(invoiceId);
        if (!invoice || invoice.id !== invoiceId) throw new IdentityMismatch();
        try { validateInvoice(invoice, snapshot); } catch { throw new IdentityMismatch(); }
        if (invoice.status === "open" && subscription.pending_update
          && subscription.items.data.length === 1 && subscription.items.data[0].price.id === snapshot.sourcePriceId) {
          // A PaymentIntent processing in the background cannot be safely canceled/retried.
          const processing = await invoiceProcessing(invoice.id);
          review.state = processing ? "processing" : "awaiting_payment";
          review.expiresAt = deadline(subscription.pending_update.expires_at);
          if (!processing && action === "cancel") {
            closureRequested = true;
            try { await stripe.invoices.voidInvoice(invoice.id, {}, { idempotencyKey: `learning-guide-order-cancel-${order.id}` }); }
            catch { /* A concurrent payment may have won; retrieve before deciding. */ }
            invoice = await stripe.invoices.retrieve(invoice.id);
            if (invoice.status === "open" && await invoiceProcessing(invoice.id)) review.state = "processing";
          } else if (!processing && action === "resume") checkoutUrl = hostedUrl(invoice.hosted_invoice_url, "invoice");
        } else review.state = invoice.status === "paid" ? "synchronising" : "processing";
        review.providerStatus = invoice.status;
        try {
          await reconcileStripeUpgradeInvoice({ id: `order-review:${order.id}:${invoice.id}:${invoice.status}`, type: "order.invoice.retrieved" }, invoice);
        } catch {
          if (invoice.status !== "paid") throw new IdentityMismatch();
          review.state = "synchronising"; review.reason = "fulfilment_pending";
        }
      }
    } else if (order.stripeCheckoutSessionId) {
      const stripe = getStripe();
      let session = await stripe.checkout.sessions.retrieve(order.stripeCheckoutSessionId, { expand: ["line_items", "payment_intent"] });
      validateCheckout(order, session);
      review.providerStatus = session.status;
      review.expiresAt = deadline(session.expires_at);
      const payment = session.status === "open" && session.payment_status === "unpaid"
        ? typeof session.payment_intent === "string" ? await stripe.paymentIntents.retrieve(session.payment_intent) : session.payment_intent : null;
      const processing = payment && ["processing", "succeeded", "requires_capture"].includes(payment.status);
      if (session.status === "open" && session.payment_status === "unpaid" && !processing) {
        review.state = "awaiting_payment";
        if (action === "cancel") {
          closureRequested = true;
          try { await stripe.checkout.sessions.expire(session.id, {}, { idempotencyKey: `learning-guide-order-cancel-${order.id}` }); }
          catch { /* A concurrent completion/expiration is reconciled below. */ }
          session = await stripe.checkout.sessions.retrieve(session.id, { expand: ["line_items", "payment_intent"] });
          validateCheckout(order, session);
          review.providerStatus = session.status;
          if (session.status !== "open" || session.payment_status !== "unpaid") review.state = session.status === "complete" && session.payment_status !== "unpaid" ? "synchronising" : "processing";
          // Re-read a processing intent if completion started while cancellation was in flight.
          if (session.status === "open" && session.payment_intent) {
            const currentPayment = typeof session.payment_intent === "string" ? await stripe.paymentIntents.retrieve(session.payment_intent) : session.payment_intent;
            if (["processing", "succeeded", "requires_capture"].includes(currentPayment.status)) review.state = "processing";
          }
        } else if (action === "resume") checkoutUrl = hostedUrl(session.url, "checkout");
      } else review.state = session.status === "complete" && session.payment_status !== "unpaid" ? "synchronising" : "processing";
      try {
        await reconcileStripeCheckout({ id: `order-review:${order.id}:${session.id}:${session.status}:${session.payment_status}`, type: "order.checkout.retrieved" }, session.id);
      } catch {
        if (session.status !== "complete" || session.payment_status === "unpaid") throw new IdentityMismatch();
        review.state = "synchronising"; review.reason = "fulfilment_pending";
      }
    } else { review.reason = "missing_payment"; }
  } catch (error) {
    review.state = "unavailable";
    review.reason = error instanceof IdentityMismatch ? "identity_mismatch" : "provider_unavailable";
    checkoutUrl = undefined;
  }
  review.checkedAt = new Date().toISOString();
  await recordOrderPaymentReview(userId, orderId, review, action, actor?.id || userId, actor ? "operator" : "learner", closureRequested);
  order = await getOrderForUser(userId, orderId);
  if (!order) throw new OrderManagementError("not_found", 404);
  const projected = projectManagedOrder(order);
  return { order: projected, ...(checkoutUrl && projected.canResume ? { checkoutUrl } : {}) };
}
