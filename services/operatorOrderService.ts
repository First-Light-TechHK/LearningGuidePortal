import { OrderManagementError } from "@/contracts/order-management";
import { createFullRefund } from "./stripeClient";
import { isOperator, listOperatorOrders, recordOrderActivity, refundDemoOrder, refundOrder, type ProductUser } from "./productStore";
import { manageOrderPayment } from "./orderPaymentService";

export async function actOnOperatorOrder(actor: ProductUser, input: { orderId: string; action: "refund" | "resynchronise" | "cancel"; reason?: string }) {
  if (!isOperator(actor)) throw new OrderManagementError("forbidden", 403);
  const order = (await listOperatorOrders({ search: input.orderId })).find(item => item.id === input.orderId);
  if (!order) throw new OrderManagementError("not_found", 404);
  if (input.action === "resynchronise" || input.action === "cancel") {
    const result = await manageOrderPayment(order.userId, order.id, input.action === "cancel" ? "cancel" : "check", { actor: { id: actor.id, role: "operator" } });
    if (result.order.state === "unavailable") throw new OrderManagementError("payment_unavailable", 503);
    return { order: (await listOperatorOrders({ search: order.id })).find(item => item.id === order.id) };
  }
  if (order.paymentMode === "demo") return { order: await refundDemoOrder(order.id, actor.id, input.reason || null) };
  if (order.status !== "paid" || !order.stripePaymentIntentId) throw new OrderManagementError("invalid_request", 400);
  try {
    const refund = await createFullRefund(order.stripePaymentIntentId);
    if (refund.status !== "succeeded" && refund.status !== "pending") throw new Error("Refund unavailable.");
    return { order: await refundOrder(order.id, actor.id, refund.id, input.reason || null), refund };
  } catch {
    await recordOrderActivity({ orderId: order.id, operatorId: actor.id, action: "refund", result: "failed", reason: "provider_unavailable", providerReference: order.stripePaymentIntentId });
    throw new OrderManagementError("payment_unavailable", 503);
  }
}
