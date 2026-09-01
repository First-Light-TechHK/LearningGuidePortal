import { NextResponse } from "next/server";
import { currentProductUser } from "@/services/productAuth";
import { attachStripeCheckoutSession, completeDemoCheckout, createPendingStripeOrder } from "@/services/productStore";
import { createHostedCheckout } from "@/services/stripeClient";

export async function POST(request: Request) {
  const user = await currentProductUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in is required." }, { status: 401 });
  try {
    const body = await request.json() as { quoteId?: string; locale?: "en-GB" | "zh-CN" };
    const locale = body.locale === "zh-CN" ? "zh-CN" : "en-GB";
    if ((process.env.PAYMENT_MODE || "demo") === "demo") {
      const result = await completeDemoCheckout(user.id, body.quoteId || "");
      return NextResponse.json({ ok: true, order: result.order, checkoutUrl: `/${locale}/portal/payment/success?orderId=${encodeURIComponent(result.order.id)}` });
    }
    const pending = await createPendingStripeOrder(user.id, body.quoteId || "");
    const origin = process.env.NEXT_PUBLIC_APP_URL?.trim() || request.headers.get("origin") || "http://localhost:3000";
    const session = await createHostedCheckout({ origin, locale, userEmail: user.email, orderId: pending.order.id, userId: user.id, quoteId: pending.order.quoteId, planId: pending.plan.id, courseId: pending.plan.courseId, planName: pending.plan.name, amountMinor: pending.plan.amountMinor, currency: pending.plan.currency, termMonths: pending.plan.termMonths });
    await attachStripeCheckoutSession(user.id, pending.order.id, session.id);
    return NextResponse.json({ ok: true, order: { ...pending.order, stripeCheckoutSessionId: session.id }, checkoutUrl: session.url });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Checkout failed." }, { status: 400 });
  }
}
