import { NextResponse } from "next/server";
import { activateStripeTrial, applyStripePaidInvoice, claimStripeEvent, convertStripeTrial, fulfilStripeCheckout, markStripeSubscriptionGrace, markStripeTrialGrace } from "@/services/productStore";
import { getStripe } from "@/services/stripeClient";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!signature || !secret) return NextResponse.json({ ok: false, error: "Stripe webhook is not configured." }, { status: 503 });
  try {
    const rawBody = await request.text();
    const event = getStripe().webhooks.constructEvent(rawBody, signature, secret);
    if (["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type)) {
        const session = event.data.object as { id: string; metadata?: Record<string, string>; subscription?: string | null; customer?: string | null; payment_intent?: string | null };
      const metadata = session.metadata || {};
      if (metadata.userId && metadata.quoteId && metadata.planId && metadata.kind === "trial_activation" && metadata.orderId && session.subscription) {
        await activateStripeTrial({ eventId: event.id, eventType: event.type, orderId: metadata.orderId, sessionId: session.id, subscriptionId: session.subscription, customerId: session.customer || null });
      } else if (metadata.userId && metadata.quoteId && metadata.planId) {
          await fulfilStripeCheckout({ eventId: event.id, eventType: event.type, sessionId: session.id, userId: metadata.userId, quoteId: metadata.quoteId, planId: metadata.planId, subscriptionId: session.subscription || undefined, customerId: session.customer || undefined, paymentIntentId: session.payment_intent || undefined });
      }
    } else if (["invoice.paid", "invoice.payment_failed"].includes(event.type)) {
      const invoice = event.data.object as { id: string; subscription?: string | { id?: string } | null; amount_paid?: number; payment_intent?: string | { id?: string } | null };
      const subscriptionId = typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id;
      if (subscriptionId && await claimStripeEvent(event.id, event.type)) {
        if (event.type === "invoice.paid") {
          const paymentIntentId = typeof invoice.payment_intent === "string" ? invoice.payment_intent : invoice.payment_intent?.id || null;
          const converted = await convertStripeTrial({ subscriptionId, invoiceId: invoice.id, amountMinor: invoice.amount_paid || 0, paymentIntentId });
          if (!converted) {
            const remote = await getStripe().subscriptions.retrieve(subscriptionId) as unknown as { current_period_start?: number; current_period_end?: number; cancel_at_period_end?: boolean };
            await applyStripePaidInvoice({ subscriptionId, invoiceId: invoice.id, amountMinor: invoice.amount_paid || 0, paymentIntentId, currentPeriodStart: remote.current_period_start ? new Date(remote.current_period_start * 1000).toISOString() : null, currentPeriodEnd: remote.current_period_end ? new Date(remote.current_period_end * 1000).toISOString() : null });
          }
        } else {
          const trial = await markStripeTrialGrace(subscriptionId);
          if (!trial) await markStripeSubscriptionGrace(subscriptionId);
        }
      }
    } else {
      return NextResponse.json({ ok: true, ignored: true });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Stripe webhook failed." }, { status: 400 });
  }
}
