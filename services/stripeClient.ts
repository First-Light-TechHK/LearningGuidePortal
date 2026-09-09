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
  if (!stripe) stripe = new Stripe(secret);
  return stripe;
}

export async function resolveStripePrice(planId: string, months: number, amountMinor?: number, currency = "usd") {
  const reference = configuredStripePrice(planId);
  if (!reference) throw new Error(`No Stripe price is configured for ${planId}.`);
  const price = reference.startsWith("price_") ? await getStripe().prices.retrieve(reference)
    : (await getStripe().prices.list({ active: true, lookup_keys: [reference], limit: 2 })).data[0];
  if (!price) throw new Error(`Stripe price not found for ${planId}.`);
  return validateStripePrice(price, { months, amountMinor, currency });
}

async function recurringLineItem(input: { planId: string; termMonths: number; amountMinor: number; currency: string; planName: string }): Promise<Stripe.Checkout.SessionCreateParams.LineItem> {
  if (configuredStripePrice(input.planId) || process.env.STRIPE_SANDBOX === "1") {
    const price = await resolveStripePrice(input.planId, input.termMonths, input.amountMinor, input.currency);
    return { price: price.id, quantity: 1 };
  }
  return { quantity: 1, price_data: { currency: input.currency, unit_amount: input.amountMinor, product_data: { name: input.planName }, recurring: { interval: "month", interval_count: input.termMonths } } };
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

export async function createHostedCheckout(input: {
  origin: string;
  locale: "en-GB" | "zh-CN";
  userEmail: string | null;
  orderId: string;
  userId: string;
  quoteId: string;
  planId: string;
  courseId: string;
  planName: string;
  amountMinor: number;
  currency: string;
  termMonths: number;
  scopeType?: "course" | "category" | "everything";
  scopeId?: string | null;
}) {

  const scopeType = input.scopeType || (input.courseId === "*" ? "everything" : "course");
  const session = await getStripe().checkout.sessions.create({
    mode: "subscription",
    ...sandboxCheckoutOptions(),
    customer_email: input.userEmail || undefined,
    line_items: [await recurringLineItem(input)],
    metadata: { orderId: input.orderId, userId: input.userId, quoteId: input.quoteId, planId: input.planId, courseId: input.courseId, scopeType, scopeId: input.scopeId || input.courseId },
    subscription_data: { metadata: { orderId: input.orderId, userId: input.userId, planId: input.planId, courseId: input.courseId, scopeType, scopeId: input.scopeId || input.courseId } },
    success_url: `${input.origin}/${input.locale}/portal/payment/success?orderId=${encodeURIComponent(input.orderId)}`,
    cancel_url: `${input.origin}/${input.locale}/portal/subscription/confirmation?quoteId=${encodeURIComponent(input.quoteId)}`
  }, { idempotencyKey: `lg-checkout-${input.orderId}` });
  if (!session.url) throw new Error("Stripe did not return a checkout URL.");
  return { id: session.id, url: session.url };
}

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
    mode: "payment",
    ...sandboxCheckoutOptions(),
    customer_email: input.userEmail || undefined,
    line_items: [{ quantity: 1, price_data: { currency: input.currency, unit_amount: input.amountMinor, product_data: { name: input.planName } } }],
    metadata: { kind: "upgrade", orderId: input.orderId, userId: input.userId, quoteId: input.quoteId, planId: input.planId, sourceSubscriptionId: input.sourceSubscriptionId },
    success_url: `${input.origin}/${input.locale}/portal/payment/success?orderId=${encodeURIComponent(input.orderId)}`,
    cancel_url: `${input.origin}/${input.locale}/portal/subscription/confirmation?quoteId=${encodeURIComponent(input.quoteId)}`
  });
  if (!session.url) throw new Error("Stripe did not return a checkout URL.");
  return { id: session.id, url: session.url };
}

export async function createHostedTrialCheckout(input: {
  origin: string;
  locale: "en-GB" | "zh-CN";
  userEmail: string | null;
  orderId: string;
  userId: string;
  quoteId: string;
  planId: string;
  courseId: string;
  planName: string;
  amountMinor: number;
  currency: string;
  termMonths: number;
  scopeType?: "course" | "category" | "everything";
  scopeId?: string | null;
}) {

  const scopeType = input.scopeType || (input.courseId === "*" ? "everything" : "course");
  const session = await getStripe().checkout.sessions.create({
    mode: "subscription",
    customer_email: input.userEmail || undefined,
    payment_method_collection: "always",
    ...sandboxCheckoutOptions(),
    line_items: [await recurringLineItem(input)],
    metadata: { kind: "trial_activation", orderId: input.orderId, userId: input.userId, quoteId: input.quoteId, planId: input.planId, courseId: input.courseId, scopeType, scopeId: input.scopeId || input.courseId },
    subscription_data: { trial_period_days: 3, metadata: { kind: "trial_activation", orderId: input.orderId, userId: input.userId, planId: input.planId, courseId: input.courseId, scopeType, scopeId: input.scopeId || input.courseId } },
    success_url: `${input.origin}/${input.locale}/portal/payment/success?orderId=${encodeURIComponent(input.orderId)}`,
    cancel_url: `${input.origin}/${input.locale}/portal/subscription/confirmation?quoteId=${encodeURIComponent(input.quoteId)}`
  });
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
