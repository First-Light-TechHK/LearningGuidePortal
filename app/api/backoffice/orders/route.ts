import { NextResponse } from "next/server";
import { currentOperatorUser } from "@/services/productAuth";
import { isOperator } from "@/services/productStore";
import { applyOperatorOrderAction, listBackofficeOrders, OrderActionError } from "@/services/orderManagementService";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await currentOperatorUser();
  if (!user || !isOperator(user)) return NextResponse.json({ ok: false, error: "Course Manager/Operator access is required." }, { status: 403 });
  const params = new URL(request.url).searchParams;
  return NextResponse.json({ ok: true, orders: await listBackofficeOrders({ search: params.get("search") || undefined, status: params.get("status") || undefined, paymentMode: params.get("paymentMode") || undefined }) });
}

export async function POST(request: Request) {
  const user = await currentOperatorUser();
  if (!user || !isOperator(user)) return NextResponse.json({ ok: false, error: "Course Manager/Operator access is required." }, { status: 403 });
  try {
    const body = await request.json() as { orderId?: string; action?: "refund" | "resynchronise"; reason?: string };
    if (!body.orderId || !body.action) return NextResponse.json({ ok: false, error: "An order action is required." }, { status: 400 });
    return NextResponse.json({ ok: true, ...await applyOperatorOrderAction({ operatorId: user.id, orderId: body.orderId, action: body.action, reason: body.reason || null }) });
  } catch (error) {
    const status = error instanceof OrderActionError ? error.status : 400;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Order action failed." }, { status });
  }
}
