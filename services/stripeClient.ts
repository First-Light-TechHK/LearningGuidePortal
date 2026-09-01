import Stripe from "stripe";

let stripe: Stripe | null = null;

export function getStripe() {
  const secret = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secret) throw new Error("STRIPE_SECRET_KEY is not configured.");
  if (!stripe) stripe = new Stripe(secret);
  return stripe;
}

export async function createHostedCheckout(input: {
  origin: string;
  locale: "en-GB" | "zh-CN";
  userEmail: string;
  orderId: string;
  userId: string;
  quoteId: string;
  planId: string;
  courseId: string;
  planName: string;
  amountMinor: number;
  currency: string;
  termMonths: number;
}) {
  const session = await getStripe().checkout.sessions.create({
    mode: "subscription",
    customer_email: input.userEmail,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: input.currency,
        unit_amount: input.amountMinor,
        product_data: { name: input.planName },
        recurring: { interval: "month", interval_count: input.termMonths }
      }
    }],
    metadata: { orderId: input.orderId, userId: input.userId, quoteId: input.quoteId, planId: input.planId, courseId: input.courseId },
    subscription_data: { metadata: { orderId: input.orderId, userId: input.userId, planId: input.planId, courseId: input.courseId } },
    success_url: `${input.origin}/${input.locale}/portal/payment/success?orderId=${encodeURIComponent(input.orderId)}`,
    cancel_url: `${input.origin}/${input.locale}/portal/courses/${encodeURIComponent(input.courseId)}`
  });
  if (!session.url) throw new Error("Stripe did not return a checkout URL.");
  return { id: session.id, url: session.url };
}
