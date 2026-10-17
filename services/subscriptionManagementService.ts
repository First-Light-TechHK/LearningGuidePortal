import { SubscriptionManagementError, type SubscriptionChange } from "@/contracts/subscription-management";
import { completeSubscriptionChange, prepareSubscriptionChange } from "./productStore";
import { isProductionEnvironment, paymentMode } from "./runtimeConfig";
import { getStripe } from "./stripeClient";
import { stripeIdentity } from "./stripeUpgradeProration";

export async function changeUserSubscription(userId: string, input: SubscriptionChange) {
  const mode = paymentMode();
  if (!["demo", "stripe"].includes(mode) || isProductionEnvironment() && mode !== "stripe") throw new SubscriptionManagementError("provider_unavailable", 503);
  const { subscription, operation } = await prepareSubscriptionChange(userId, input);
  if (!operation) return subscription;
  if (mode === "stripe") {
    if (!subscription.stripeSubscriptionId || !subscription.stripeCustomerId) throw new SubscriptionManagementError("provider_unavailable", 503);
    try {
      const stripe = getStripe(), remote = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId);
      if (remote.id !== subscription.stripeSubscriptionId || stripeIdentity(remote.customer) !== subscription.stripeCustomerId || !["active", "trialing", "past_due"].includes(remote.status)) throw new Error("Subscription cannot be updated.");
      const updated = await stripe.subscriptions.update(remote.id, { cancel_at_period_end: operation.action === "cancel" }, { idempotencyKey: `learning-guide-renewal-${operation.id}` });
      if (updated.id !== remote.id || stripeIdentity(updated.customer) !== subscription.stripeCustomerId || updated.cancel_at_period_end !== (operation.action === "cancel")) throw new Error("Subscription update not confirmed.");
    } catch { throw new SubscriptionManagementError("provider_unavailable", 503); }
  }
  return completeSubscriptionChange(userId, subscription.id, operation.id);
}
