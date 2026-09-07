import { NextResponse } from "next/server";
import { currentProductUser } from "@/services/productAuth";
import { attachStripeCheckoutSession, completeDemoUpgradeOrder, completeStripeUpgradeOrder, createPendingDemoOrder, createPendingDemoUpgradeOrderFromQuote, createPendingStripeOrder, createPendingStripeUpgradeOrderFromQuote, getQuoteForUser } from "@/services/productStore";
import { createHostedCheckout, createHostedUpgradeCheckout } from "@/services/stripeClient";
import { isProductionEnvironment, paymentMode, publicAppOrigin, runtimeConfiguration } from "@/services/runtimeConfig";

export async function POST(request: Request) {
  const user = await currentProductUser();
  if (!user) return NextResponse.json({ ok: false, error: "Sign in is required." }, { status: 401 });
  try {
    const mode = paymentMode();
    if (isProductionEnvironment() && mode !== "stripe") return NextResponse.json({ ok: false, error: "Live payment mode must be enabled before production checkout." }, { status: 503 });
    if (mode === "stripe" && !runtimeConfiguration().payment.configured) return NextResponse.json({ ok: false, error: "Stripe is not fully configured. Set STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET and NEXT_PUBLIC_APP_URL." }, { status: 503 });
    const body = await request.json() as { quoteId?: string; locale?: "en-GB" | "zh-CN"; consents?: { renewal?: boolean; terms?: boolean; refund?: boolean } };
    if (!body.consents?.renewal || !body.consents.terms || !body.consents.refund) return NextResponse.json({ ok: false, error: "All subscription confirmations are required." }, { status: 400 });
    const locale = body.locale === "zh-CN" ? "zh-CN" : "en-GB";
    const quoted = await getQuoteForUser(user.id, body.quoteId || "");
    if (!quoted) return NextResponse.json({ ok: false, error: "Quote not found or expired." }, { status: 400 });
    if (quoted.quote.kind === "upgrade") {
      const pending = mode === "demo"
        ? await createPendingDemoUpgradeOrderFromQuote(user.id, quoted.quote.id)
        : await createPendingStripeUpgradeOrderFromQuote(user.id, quoted.quote.id);
      if (quoted.quote.amountMinor === 0) {
        const result = mode === "demo" ? await completeDemoUpgradeOrder(user.id, pending.order.id) : await completeStripeUpgradeOrder(user.id, pending.order.id);
        return NextResponse.json({ ok: true, order: result.order, checkoutUrl: `/${locale}/account/my-learning` });
      }
      if (mode === "demo") return NextResponse.json({ ok: true, order: pending.order, checkoutUrl: `/${locale}/portal/payment/checkout?orderId=${encodeURIComponent(pending.order.id)}` });
      const sourceSubscriptionId = quoted.quote.sourceSubscriptionId;
      if (!sourceSubscriptionId) return NextResponse.json({ ok: false, error: "Upgrade source subscription is missing." }, { status: 400 });
      const session = await createHostedUpgradeCheckout({ origin: publicAppOrigin(request), locale, userEmail: user.email, orderId: pending.order.id, userId: user.id, quoteId: pending.order.quoteId, planId: pending.plan.id, sourceSubscriptionId, planName: pending.plan.name, amountMinor: pending.order.amountMinor, currency: pending.plan.currency });
      await attachStripeCheckoutSession(user.id, pending.order.id, session.id);
      return NextResponse.json({ ok: true, order: { ...pending.order, stripeCheckoutSessionId: session.id }, checkoutUrl: session.url });
    }
    if (mode === "demo") {
      const result = await createPendingDemoOrder(user.id, body.quoteId || "");
      return NextResponse.json({ ok: true, order: result.order, checkoutUrl: `/${locale}/portal/payment/checkout?orderId=${encodeURIComponent(result.order.id)}` });
    }
    const pending = await createPendingStripeOrder(user.id, body.quoteId || "");
    const origin = publicAppOrigin(request);
    const session = await createHostedCheckout({ origin, locale, userEmail: user.email, orderId: pending.order.id, userId: user.id, quoteId: pending.order.quoteId, planId: pending.plan.id, courseId: pending.plan.courseId, scopeType: pending.plan.scope, scopeId: pending.plan.scopeId || pending.plan.category, planName: pending.plan.name, amountMinor: pending.plan.amountMinor, currency: pending.plan.currency, termMonths: pending.plan.termMonths });
    await attachStripeCheckoutSession(user.id, pending.order.id, session.id);
    return NextResponse.json({ ok: true, order: { ...pending.order, stripeCheckoutSessionId: session.id }, checkoutUrl: session.url });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Checkout failed." }, { status: 400 });
  }
}
