import { NextResponse } from "next/server";
import { currentProductUser } from "@/services/productAuth";
import { attachStripeCheckoutSession, createPendingDemoTrialOrder, createPendingStripeTrialOrder } from "@/services/productStore";
import { createHostedTrialCheckout } from "@/services/stripeClient";
import { isProductionEnvironment } from "@/services/runtimeConfig";

export async function POST(request: Request) {
  const user = await currentProductUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in is required." }, { status: 401 });
  try {
    const paymentMode = (process.env.PAYMENT_MODE || "demo").trim().toLowerCase();
    if (isProductionEnvironment() && paymentMode !== "stripe") return NextResponse.json({ ok: false, error: "Live payment mode must be enabled before production trial activation." }, { status: 503 });
    const body = await request.json() as { courseId?: string; planId?: string; locale?: "en-GB" | "zh-CN" };
    const locale = body.locale === "zh-CN" ? "zh-CN" : "en-GB";
    if (paymentMode === "demo") {
      const pending = await createPendingDemoTrialOrder(user.id, body.planId || "", body.courseId);
      return NextResponse.json({ ok: true, order: pending.order, checkoutUrl: `/${locale}/portal/payment/checkout?orderId=${encodeURIComponent(pending.order.id)}` });
    }
    if (paymentMode === "stripe") {
      const pending = await createPendingStripeTrialOrder(user.id, body.planId || "");
      const origin = process.env.NEXT_PUBLIC_APP_URL?.trim() || request.headers.get("origin") || "http://localhost:3000";
      const session = await createHostedTrialCheckout({ origin, locale, userEmail: user.email, orderId: pending.order.id, userId: user.id, quoteId: pending.order.quoteId, planId: pending.plan.id, courseId: pending.plan.courseId, planName: pending.plan.name, amountMinor: pending.plan.amountMinor, currency: pending.plan.currency, termMonths: pending.plan.termMonths });
      await attachStripeCheckoutSession(user.id, pending.order.id, session.id);
      return NextResponse.json({ ok: true, order: { ...pending.order, stripeCheckoutSessionId: session.id }, checkoutUrl: session.url });
    }
    return NextResponse.json({ ok: false, error: "Unsupported payment mode." }, { status: 503 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Trial activation failed." }, { status: 400 });
  }
}
