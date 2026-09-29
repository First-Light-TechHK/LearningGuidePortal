import { NextResponse } from "next/server";
import { currentProductUser } from "@/services/productAuth";
import { completeDemoOrder, completeDemoTrialOrder, getOrderForUser, updateDemoOrderStatus } from "@/services/productStore";

export async function POST(request: Request) {
  const user = await currentProductUser(request);
  if (!user) return NextResponse.json({ ok: false, error: "Sign in is required." }, { status: 401 });
  try {
    const body = await request.json() as { orderId?: string; action?: "complete" | "fail" | "cancel" };
    const order = await getOrderForUser(user.id, body.orderId || "");
    if (!order || order.paymentMode !== "demo") return NextResponse.json({ ok: false, error: "Local payment order not found." }, { status: 404 });
    if (body.action === "complete") {
      const result = order.kind === "trial_activation" ? await completeDemoTrialOrder(user.id, order.id) : await completeDemoOrder(user.id, order.id);
      return NextResponse.json({ ok: true, order: result.order, status: "paid" });
    }
    const status = body.action === "cancel" ? "canceled" : "failed";
    const updated = await updateDemoOrderStatus(user.id, order.id, status, status === "canceled" ? "Cancelled on local checkout." : "Failed on local checkout.");
    return NextResponse.json({ ok: true, order: updated, status: updated.status });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Local payment update failed." }, { status: 400 });
  }
}
