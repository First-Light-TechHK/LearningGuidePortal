import type Stripe from "stripe";
import { activateStripeTrial, applyStripePaidInvoice, stripeEventProcessed, completeStripeEvent, convertStripeTrial, fulfilStripeCheckout, markStripeSubscriptionGrace, markStripeTrialGrace, recordStripeCheckoutFailure } from "@/services/productStore";
import { getStripe } from "@/services/stripeClient";

export async function processLegacyStripeEvent(event: Stripe.Event) {
    if (process.env.STRIPE_SANDBOX === "1" && event.livemode) return { ok: false, error: "Live events are not allowed in this sandbox." };
    if (["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type)) {
        const session = event.data.object as { id: string; payment_status?: string; amount_total?: number; currency?: string; metadata?: Record<string, string>; subscription?: string | null; customer?: string | null; payment_intent?: string | null };
      const metadata = session.metadata || {};
      if (session.payment_status === "unpaid") return { ok: true, pending: true };
      if (!["paid", "no_payment_required"].includes(session.payment_status || "")) throw new Error("Checkout payment status is missing or unsupported.");
      if (metadata.userId && metadata.quoteId && metadata.planId && metadata.kind === "trial_activation" && metadata.orderId && session.subscription) {
        await activateStripeTrial({ eventId: event.id, eventType: event.type, orderId: metadata.orderId, sessionId: session.id, subscriptionId: session.subscription, customerId: session.customer || null });
      } else if (metadata.userId && metadata.quoteId && metadata.planId) {
          await fulfilStripeCheckout({ eventId: event.id, eventType: event.type, sessionId: session.id, userId: metadata.userId, quoteId: metadata.quoteId, planId: metadata.planId, amountMinor: session.amount_total, currency: session.currency, subscriptionId: session.subscription || undefined, customerId: session.customer || undefined, paymentIntentId: session.payment_intent || undefined });
      }
    } else if (["checkout.session.expired", "checkout.session.async_payment_failed"].includes(event.type)) {
      const session = event.data.object as { id: string; metadata?: Record<string, string> };
      if (session.metadata?.orderId) await recordStripeCheckoutFailure({ eventId: event.id, eventType: event.type, orderId: session.metadata.orderId, sessionId: session.id, status: event.type === "checkout.session.expired" ? "canceled" : "failed" });
    } else if (["invoice.paid", "invoice.payment_failed"].includes(event.type)) {
      const invoice = event.data.object as { id: string; subscription?: string | { id?: string } | null; parent?: { subscription_details?: { subscription?: string | { id?: string } | null } }; amount_paid?: number; payment_intent?: string | { id?: string } | null };
      const reference = invoice.parent?.subscription_details?.subscription || invoice.subscription;
      const subscriptionId = typeof reference === "string" ? reference : reference?.id;
      if (subscriptionId && !await stripeEventProcessed(event.id)) {
        if (event.type === "invoice.paid") {
          const remote = await getStripe().subscriptions.retrieve(subscriptionId);
          if (remote.status === "trialing" && !invoice.amount_paid) return { ok: true, ignored: true };
          const paymentIntentId = typeof invoice.payment_intent === "string" ? invoice.payment_intent : invoice.payment_intent?.id || null;
          const converted = await convertStripeTrial({ subscriptionId, invoiceId: invoice.id, amountMinor: invoice.amount_paid || 0, paymentIntentId });
          if (!converted) {
            const legacy = remote as unknown as { current_period_start?: number; current_period_end?: number };
            const start = remote.items.data[0]?.current_period_start || legacy.current_period_start;
            const end = remote.items.data[0]?.current_period_end || legacy.current_period_end;
            const applied = await applyStripePaidInvoice({ subscriptionId, invoiceId: invoice.id, amountMinor: invoice.amount_paid || 0, paymentIntentId, currentPeriodStart: start ? new Date(start * 1000).toISOString() : null, currentPeriodEnd: end ? new Date(end * 1000).toISOString() : null });
            if (!applied) throw new Error("Subscription is not ready for invoice processing; retry this event.");
          }
        } else {
          const trial = await markStripeTrialGrace(subscriptionId);
          if (!trial && !await markStripeSubscriptionGrace(subscriptionId)) throw new Error("Subscription is not ready for payment failure processing; retry this event.");
        }
        await completeStripeEvent(event.id, event.type);
      }
    } else {
      return { ok: true, ignored: true };
    }
    return { ok: true };

}
