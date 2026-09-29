import { cancelSubscription, getLearningOverview, getOrderForUser, resumeSubscription, type ProductUser } from "./productStore";
import { createCustomerPortalSession, getSubscriptionPaymentUrl, retrieveHostedInvoiceUrl, updateSubscriptionCancelAtPeriodEnd } from "./stripeClient";
import { paymentMode, publicAppOrigin, runtimeConfiguration } from "./runtimeConfig";

export async function changeLearnerSubscription(
  userId: string,
  input: { subscriptionId: string; action: "cancel" | "resume"; reasonCode?: "low_usage" | "too_expensive" | "content" | "website" | "other"; reasonText?: string },
) {
  const current = (await getLearningOverview(userId)).subscriptions.find((subscription) => subscription.id === input.subscriptionId);
  if (!current) throw new Error("Subscription not found.");
  if (input.action === "resume" && current.source === "purchase") {
    throw new Error("Auto-renewal cannot be restored. You can purchase a new plan after the current period ends.");
  }
  if (current.stripeSubscriptionId && paymentMode() === "stripe") {
    await updateSubscriptionCancelAtPeriodEnd(current.stripeSubscriptionId, input.action === "cancel");
  }
  return input.action === "cancel"
    ? cancelSubscription(userId, input.subscriptionId, { code: input.reasonCode, text: input.reasonText })
    : resumeSubscription(userId, input.subscriptionId);
}

export async function openLearnerBillingSession(
  user: ProductUser,
  request: Request,
  input: { locale?: "en-GB" | "zh-CN"; subscriptionId?: string; action?: "manage" | "pay" },
) {
  if (paymentMode() !== "stripe") throw new Error("Billing is in demo mode.");
  if (!runtimeConfiguration().payment.configured) throw new Error("Stripe is not fully configured.");
  const locale = input.locale === "zh-CN" ? "zh-CN" : "en-GB";
  if (input.action === "pay" && !input.subscriptionId) throw new Error("Select the subscription to pay.");
  const subscription = (await getLearningOverview(user.id)).subscriptions.find((item) => item.source === "purchase" && item.stripeCustomerId && (!input.subscriptionId || item.id === input.subscriptionId));
  if (!subscription?.stripeCustomerId) throw new Error("A Stripe customer is not available for this account yet.");
  if (input.action === "pay") {
    if (!subscription.stripeSubscriptionId) throw new Error("This subscription has no Stripe billing record.");
    return { url: await getSubscriptionPaymentUrl(subscription.stripeSubscriptionId, subscription.stripeCustomerId) };
  }
  const origin = publicAppOrigin(request);
  return { url: await createCustomerPortalSession({ customerId: subscription.stripeCustomerId, returnUrl: `${origin}/${locale}/account/my-learning/subscription`, locale }) };
}

export async function getPaidOrderReceipt(userId: string, orderId: string) {
  const order = await getOrderForUser(userId, orderId);
  if (!order || order.status !== "paid" || order.kind === "trial_activation") return { kind: "unavailable" as const };
  if (order.paymentMode === "stripe" && order.stripeInvoiceId) {
    const url = await retrieveHostedInvoiceUrl(order.stripeInvoiceId);
    return url ? { kind: "redirect" as const, url } : { kind: "unavailable" as const };
  }
  return { kind: "demo" as const, order };
}
