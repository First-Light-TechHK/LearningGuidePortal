import { NextResponse } from "next/server";
import { currentProductUser } from "@/services/productAuth";
import { applyStripeOrderState, isOperator, listOperatorOrders, recordOrderActivity, refundDemoOrder, refundOrder } from "@/services/productStore";
import { createFullRefund, retrieveCheckoutState } from "@/services/stripeClient";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await currentProductUser();
  if (!user || !isOperator(user)) return NextResponse.json({ ok: false, error: "Course Manager/Operator access is required." }, { status: 403 });
  const params = new URL(request.url).searchParams;
  return NextResponse.json({ ok: true, orders: await listOperatorOrders({ search: params.get("search") || undefined, status: params.get("status") || undefined, paymentMode: params.get("paymentMode") || undefined }) });
}

export async function POST(request: Request) {
  const user = await currentProductUser();
  if (!user || !isOperator(user)) return NextResponse.json({ ok: false, error: "Course Manager/Operator access is required." }, { status: 403 });
  try {
    const body = await request.json() as { orderId?: string; action?: "refund" | "resynchronise"; reason?: string };
    if (!body.orderId || !body.action) return NextResponse.json({ ok: false, error: "An order action is required." }, { status: 400 });
    const orders = await listOperatorOrders({ search: body.orderId });
    const order = orders.find((item) => item.id === body.orderId);
    if (!order) return NextResponse.json({ ok: false, error: "Order not found." }, { status: 404 });
    if (body.action === "resynchronise") {
      if (!order.stripeCheckoutSessionId || order.paymentMode !== "stripe") return NextResponse.json({ ok: false, error: "A Stripe Checkout Session is required for resynchronisation." }, { status: 400 });
      try {
        const state = await retrieveCheckoutState(order.stripeCheckoutSessionId);
        return NextResponse.json({ ok: true, order: await applyStripeOrderState({ orderId: order.id, operatorId: user.id, ...state, reason: null }) });
      } catch (error) {
        await recordOrderActivity({ orderId: order.id, operatorId: user.id, action: "resynchronise", result: "failed", reason: error instanceof Error ? error.message : "Stripe synchronisation failed.", providerReference: order.stripeCheckoutSessionId });
        return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Stripe synchronisation failed." }, { status: 502 });
      }
    }
    if (order.paymentMode === "demo") return NextResponse.json({ ok: true, order: await refundDemoOrder(order.id, user.id, body.reason || null) });
    if (!order.stripePaymentIntentId) return NextResponse.json({ ok: false, error: "A Stripe PaymentIntent is required for a refund." }, { status: 400 });
    try {
      const refund = await createFullRefund(order.stripePaymentIntentId);
      if (refund.status !== "succeeded" && refund.status !== "pending") throw new Error(`Stripe refund status: ${refund.status}`);
      return NextResponse.json({ ok: true, order: await refundOrder(order.id, user.id, refund.id, body.reason || null), refund });
    } catch (error) {
      await recordOrderActivity({ orderId: order.id, operatorId: user.id, action: "refund", result: "failed", reason: error instanceof Error ? error.message : "Stripe refund failed.", providerReference: order.stripePaymentIntentId });
      return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Stripe refund failed." }, { status: 502 });
    }
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Order action failed." }, { status: 400 });
  }
}
