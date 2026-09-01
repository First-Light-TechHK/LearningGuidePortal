import { NextResponse } from "next/server";
import { currentProductUser } from "@/services/productAuth";
import { attachStripeCheckoutSession, createPendingDemoTrialOrder, createPendingStripeTrialOrder } from "@/services/productStore";
import { createHostedTrialCheckout } from "@/services/stripeClient";
import { isProductionEnvironment, paymentMode, publicAppOrigin, runtimeConfiguration } from "@/services/runtimeConfig";

export async function POST(request: Request) {
  const user = await currentProductUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in is required." }, { status: 401 });
  try {
    const mode = paymentMode();
    if (isProductionEnvironment() && mode !== "stripe") return NextResponse.json({ ok: false, error: "Live payment mode must be enabled before production trial activation." }, { status: 503 });
    if (mode === "stripe" && !runtimeConfiguration().payment.configured) return NextResponse.json({ ok: false, error: "Stripe is not fully configured. Set STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET and NEXT_PUBLIC_APP_URL." }, { status: 503 });
    const body = await request.json() as { courseId?: string; planId?: string; locale?: "en-GB" | "zh-CN" };
    const locale = body.locale === "zh-CN" ? "zh-CN" : "en-GB";
    if (mode === "demo") {
      const pending = await createPendingDemoTrialOrder(user.id, body.planId || "", body.courseId);
      return NextResponse.json({ ok: true, order: pending.order, checkoutUrl: `/${locale}/portal/payment/checkout?orderId=${encodeURIComponent(pending.order.id)}` });
    }
    if (mode === "stripe") {
      const pending = await createPendingStripeTrialOrder(user.id, body.planId || "");
      const origin = publicAppOrigin(request);
      const session = await createHostedTrialCheckout({ origin, locale, userEmail: user.email, orderId: pending.order.id, userId: user.id, quoteId: pending.order.quoteId, planId: pending.plan.id, courseId: pending.plan.courseId, planName: pending.plan.name, amountMinor: pending.plan.amountMinor, currency: pending.plan.currency, termMonths: pending.plan.termMonths });
      await attachStripeCheckoutSession(user.id, pending.order.id, session.id);
      return NextResponse.json({ ok: true, order: { ...pending.order, stripeCheckoutSessionId: session.id }, checkoutUrl: session.url });
    }
    return NextResponse.json({ ok: false, error: "Unsupported payment mode." }, { status: 503 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Trial activation failed." }, { status: 400 });
  }
}
