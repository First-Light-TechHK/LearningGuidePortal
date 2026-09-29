import { NextResponse } from "next/server";
import { currentProductUser } from "@/services/productAuth";
import { openLearnerBillingSession } from "@/services/subscriptionPaymentService";

export async function POST(request: Request) {
  const user = await currentProductUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in is required." }, { status: 401 });
  try {
    const body = await request.json() as { locale?: "en-GB" | "zh-CN"; subscriptionId?: string; action?: "manage" | "pay" };
    return NextResponse.json({ ok: true, ...await openLearnerBillingSession(user, request, body) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Stripe customer portal could not be opened.";
    const status = message === "Billing is in demo mode." ? 400 : message === "Stripe is not fully configured." ? 503 : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
