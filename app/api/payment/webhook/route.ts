import { NextResponse } from "next/server";
import { fulfilStripeCheckout } from "@/services/productStore";
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
      const session = event.data.object as { id: string; metadata?: Record<string, string>; subscription?: string | null };
      const metadata = session.metadata || {};
      if (metadata.userId && metadata.quoteId && metadata.planId) {
        await fulfilStripeCheckout({ eventId: event.id, eventType: event.type, sessionId: session.id, userId: metadata.userId, quoteId: metadata.quoteId, planId: metadata.planId, subscriptionId: session.subscription || undefined });
      }
    } else {
      // Record only payment events that are actionable in the Phase 1 state model later.
      return NextResponse.json({ ok: true, ignored: true });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Stripe webhook failed." }, { status: 400 });
  }
}
