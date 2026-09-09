import { PaymentError, type StripePriceSnapshot } from "@/contracts/payment";
import Stripe from "stripe";
import { configuredStripePrice, validateStripePrice } from "./stripePrices";

let stripe: Stripe | null = null;

function sandboxCheckoutOptions(): Pick<Stripe.Checkout.SessionCreateParams, "managed_payments" | "adaptive_pricing"> {
  return process.env.STRIPE_SANDBOX === "1" ? { managed_payments: { enabled: false }, adaptive_pricing: { enabled: false } } : {};
}

export function getStripe() {
  const secret = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secret) throw new Error("STRIPE_SECRET_KEY is not configured.");
  if (process.env.STRIPE_SANDBOX === "1" && !secret.startsWith("sk_test_")) throw new Error("This sandbox requires a Stripe test key.");
  if (!stripe) stripe = new Stripe(secret, { maxNetworkRetries: 2, timeout: 20000 });
  return stripe;
}

export async function resolveStripePrice(planId: string, months: number, amountMinor?: number, currency = "usd") {
  const reference = configuredStripePrice(planId);
  if (!reference) throw new Error(`No Stripe price is configured for ${planId}.`);
  const prices = reference.startsWith("price_") ? [await getStripe().prices.retrieve(reference)]
    : (await getStripe().prices.list({ active: true, lookup_keys: [reference], limit: 2 })).data;
  if (prices.length !== 1) throw new Error(`Expected one active Stripe price for ${planId}.`);
  const price = prices[0];
  return validateStripePrice(price, { months, amountMinor, currency });
}

export async function getSubscriptionPaymentUrl(subscriptionId: string, customerId: string) {
  const subscription = await getStripe().subscriptions.retrieve(subscriptionId, { expand: ["latest_invoice"] });
  const owner = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  if (owner !== customerId) throw new Error("The billing account does not match this subscription.");
  const invoice = typeof subscription.latest_invoice === "string"
    ? await getStripe().invoices.retrieve(subscription.latest_invoice)
    : subscription.latest_invoice;
  if (!invoice || invoice.status !== "open" || !invoice.hosted_invoice_url) {
    throw new Error("There is no unpaid invoice available for this subscription. Refresh the page to check its current status.");
  }
  return invoice.hosted_invoice_url;
}

export type SubscriptionCheckoutInput = {
  origin: string; locale: "en-GB" | "zh-CN"; userEmail: string | null;
  orderId: string; userId: string; quoteId: string; planId: string; courseId: string;
  planName: string; amountMinor: number; currency: string; termMonths: number;
  scopeType?: "course" | "category" | "everything"; scopeId?: string | null;
  price: StripePriceSnapshot;
};

async function subscriptionCheckout(input: SubscriptionCheckoutInput, trial: boolean) {
  if (!input.price?.stripePriceId) throw new PaymentError("price_unavailable", 503);
  const scopeType = input.scopeType || (input.courseId === "*" ? "everything" : "course");
  const metadata = { app: "learning_guide", kind: trial ? "trial_activation" : "purchase", orderId: input.orderId, userId: input.userId, quoteId: input.quoteId, planId: input.planId, priceId: input.price.stripePriceId, courseId: input.courseId, scopeType, scopeId: input.scopeId || input.courseId };
  const session = await getStripe().checkout.sessions.create({
    mode: "subscription", ...sandboxCheckoutOptions(),
    locale: input.locale === "zh-CN" ? "zh" : "en-GB",
    customer_email: input.userEmail || undefined, client_reference_id: input.orderId,
    line_items: [{ price: input.price.stripePriceId, quantity: 1 }], metadata,
    ...(trial ? { payment_method_collection: "always" as const } : {}),
    subscription_data: { metadata, ...(trial ? { trial_period_days: 3 } : {}) },
    success_url: input.origin + "/" + input.locale + "/portal/payment/success?orderId=" + encodeURIComponent(input.orderId),
    cancel_url: input.origin + "/" + input.locale + "/portal/subscription/confirmation?quoteId=" + encodeURIComponent(input.quoteId),
  }, { idempotencyKey: "learning-guide-checkout-" + input.orderId });
  if (!session.url) throw new PaymentError("payment_unavailable", 502);
  return { id: session.id, url: session.url };
}
export const createHostedCheckout = (input: SubscriptionCheckoutInput) => subscriptionCheckout(input, false);
export const createHostedTrialCheckout = (input: SubscriptionCheckoutInput) => subscriptionCheckout(input, true);

export async function createHostedUpgradeCheckout(input: {
  origin: string;
  locale: "en-GB" | "zh-CN";
  userEmail: string | null;
  orderId: string;
  userId: string;
  quoteId: string;
  planId: string;
  sourceSubscriptionId: string;
  planName: string;
  amountMinor: number;
  currency: string;
}) {
  const session = await getStripe().checkout.sessions.create({
    mode: "payment", ...sandboxCheckoutOptions(),
    customer_email: input.userEmail || undefined,
    line_items: [{ quantity: 1, price_data: { currency: input.currency, unit_amount: input.amountMinor, product_data: { name: input.planName } } }],
    metadata: { app: "learning_guide", kind: "upgrade", orderId: input.orderId, userId: input.userId, quoteId: input.quoteId, planId: input.planId, sourceSubscriptionId: input.sourceSubscriptionId },
    success_url: `${input.origin}/${input.locale}/portal/payment/success?orderId=${encodeURIComponent(input.orderId)}`,
    cancel_url: `${input.origin}/${input.locale}/portal/subscription/confirmation?quoteId=${encodeURIComponent(input.quoteId)}`
  }, { idempotencyKey: "learning-guide-upgrade-" + input.orderId });
  if (!session.url) throw new Error("Stripe did not return a checkout URL.");
  return { id: session.id, url: session.url };
}

export async function createCustomerPortalSession(input: { customerId: string; returnUrl: string; locale: "en-GB" | "zh-CN" }) {
  const session = await getStripe().billingPortal.sessions.create({ customer: input.customerId, return_url: input.returnUrl, locale: input.locale === "en-GB" ? "en-GB" : "zh-CN" });
  if (!session.url) throw new Error("Stripe did not return a customer portal URL.");
  return session.url;
}

export async function retrieveCheckoutState(sessionId: string) {
  const session = await getStripe().checkout.sessions.retrieve(sessionId, { expand: ["subscription", "payment_intent"] });
  const subscription = typeof session.subscription === "string" ? session.subscription : session.subscription?.id || null;
  const customer = typeof session.customer === "string" ? session.customer : session.customer?.id || null;
  const paymentIntent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || null;
  const stripeStatus = session.status === "expired" ? "canceled" : session.status === "complete" && session.payment_status === "paid" ? "paid" : "processing";
  return { stripeStatus: stripeStatus as "paid" | "processing" | "failed" | "canceled", checkoutSessionId: session.id, paymentIntentId: paymentIntent, subscriptionId: subscription, customerId: customer, paymentStatus: session.payment_status, sessionStatus: session.status };
}

export async function createFullRefund(paymentIntentId: string) {
  const refund = await getStripe().refunds.create({ payment_intent: paymentIntentId });
  return { id: refund.id, status: refund.status || "unknown" };
}
