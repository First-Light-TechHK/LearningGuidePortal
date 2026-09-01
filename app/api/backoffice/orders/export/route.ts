import { NextResponse } from "next/server";
import { currentProductUser } from "@/services/productAuth";
import { isOperator, listOperatorOrders } from "@/services/productStore";

export const dynamic = "force-dynamic";

function csv(value: unknown) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export async function GET(request: Request) {
  const user = await currentProductUser();
  if (!user || !isOperator(user)) return NextResponse.json({ ok: false, error: "Course Manager/Operator access is required." }, { status: 403 });
  const params = new URL(request.url).searchParams;
  const orders = await listOperatorOrders({ search: params.get("search") || undefined, status: params.get("status") || undefined, paymentMode: params.get("paymentMode") || undefined });
  const lines = [
    ["Order ID", "Student", "Plan", "Amount", "Currency", "Payment status", "Payment mode", "Order date", "Stripe checkout session", "Payment intent", "Exception"],
    ...orders.map((order) => [order.id, order.userEmail, order.plan?.name || "", (order.amountMinor / 100).toFixed(2), order.currency.toUpperCase(), order.status, order.paymentMode, order.createdAt, order.stripeCheckoutSessionId || "", order.stripePaymentIntentId || "", order.exceptionCode || ""])
  ].map((row) => row.map(csv).join(",")).join("\n");
  return new NextResponse(`${lines}\n`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=learning-guide-orders.csv" } });
}
