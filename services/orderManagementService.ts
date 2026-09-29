import { applyStripeOrderState, listOperatorOrders, recordOrderActivity, refundDemoOrder, refundOrder } from "./productStore";
import { cancelStripeSubscription, createFullRefund, retrieveCheckoutState } from "./stripeClient";

export class OrderActionError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function listBackofficeOrders(filters?: { search?: string; status?: string; paymentMode?: string }) {
  return listOperatorOrders(filters);
}

export async function applyOperatorOrderAction(input: {
  operatorId: string;
  orderId: string;
  action: "refund" | "resynchronise";
  reason?: string | null;
}) {
  const orders = await listOperatorOrders({ search: input.orderId });
  const order = orders.find((item) => item.id === input.orderId);
  if (!order) throw new OrderActionError("Order not found.", 404);
  if (input.action === "resynchronise") {
    if (!order.stripeCheckoutSessionId || order.paymentMode !== "stripe") {
      throw new OrderActionError("A Stripe Checkout Session is required for resynchronisation.", 400);
    }
    try {
      const state = await retrieveCheckoutState(order.stripeCheckoutSessionId);
      return { order: await applyStripeOrderState({ orderId: order.id, operatorId: input.operatorId, ...state, reason: null }) };
    } catch (error) {
      await recordOrderActivity({
        orderId: order.id,
        operatorId: input.operatorId,
        action: "resynchronise",
        result: "failed",
        reason: error instanceof Error ? error.message : "Stripe synchronisation failed.",
        providerReference: order.stripeCheckoutSessionId,
      });
      throw new OrderActionError(error instanceof Error ? error.message : "Stripe synchronisation failed.", 502);
    }
  }
  if (order.paymentMode === "demo") {
    return { order: await refundDemoOrder(order.id, input.operatorId, input.reason || null) };
  }
  if (!order.stripePaymentIntentId) throw new OrderActionError("A Stripe PaymentIntent is required for a refund.", 400);
  try {
    const refund = await createFullRefund(order.stripePaymentIntentId);
    if (refund.status !== "succeeded" && refund.status !== "pending") throw new Error(`Stripe refund status: ${refund.status}`);
    if (order.stripeSubscriptionId) {
      try {
        await cancelStripeSubscription(order.stripeSubscriptionId);
      } catch {
        // Local revoke still applies if Stripe already cancelled the subscription.
      }
    }
    return { order: await refundOrder(order.id, input.operatorId, refund.id, input.reason || null), refund };
  } catch (error) {
    await recordOrderActivity({
      orderId: order.id,
      operatorId: input.operatorId,
      action: "refund",
      result: "failed",
      reason: error instanceof Error ? error.message : "Stripe refund failed.",
      providerReference: order.stripePaymentIntentId,
    });
    throw new OrderActionError(error instanceof Error ? error.message : "Stripe refund failed.", 502);
  }
}
