import type { SubscriptionRecordOrder as Order, SubscriptionRecordSubscription as Subscription } from "@/contracts/subscription-records";

export type SubscriptionProductRecord = { id: string; subscription: Subscription | null; orders: Order[] };

/** Pure presentation grouping; subscription state and access stay server-owned. */
export function groupSubscriptionRecords(subscriptions: Subscription[], orders: Order[]): SubscriptionProductRecord[] {
  const records = subscriptions.map(subscription => ({ id: subscription.id, subscription, orders: [] as Order[] }));
  const orphanProducts = new Map<string, SubscriptionProductRecord>();
  for (const order of [...orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    const localCandidates = records.filter(item => item.subscription?.source === (order.kind === "trial_activation" ? "trial" : "purchase") && item.subscription.plan?.id && item.subscription.plan.id === order.plan?.id);
    const record = order.stripeSubscriptionId
      ? records.find(item => item.subscription?.stripeSubscriptionId === order.stripeSubscriptionId && item.subscription.plan?.id === order.plan?.id) || records.find(item => item.subscription?.stripeSubscriptionId === order.stripeSubscriptionId)
      : localCandidates.find(item => order.servicePeriodStart && item.subscription?.validFrom === order.servicePeriodStart)
        || localCandidates.find(item => item.subscription && new Date(order.createdAt) >= new Date(item.subscription.validFrom) && new Date(order.createdAt) < new Date(item.subscription.validTo))
        || (localCandidates.length === 1 ? localCandidates[0] : undefined);
    if (record) { record.orders.push(order); continue; }
    // An unsuccessful checkout alone does not establish a subscribed product.
    if (order.status !== "paid" && order.status !== "refunded") continue;
    const key = order.stripeSubscriptionId || order.plan?.id || order.presentation?.name || order.id;
    if (!orphanProducts.has(key)) orphanProducts.set(key, { id: `history-${key}`, subscription: null, orders: [] });
    orphanProducts.get(key)!.orders.push(order);
  }
  return [...records, ...orphanProducts.values()];
}

/** Display-only sections; does not grant access or change the recorded subscription state. */
export function subscriptionListRecords(subscriptions: Subscription[], orders: Order[], now = new Date()): import("@/contracts/subscription-records").SubscriptionListRecord[] {
  const everything = subscriptions.some(s => (s.scope || s.plan?.scope) === "everything" && ["active","cancel_at_period_end","grace"].includes(s.state));
  return groupSubscriptionRecords(subscriptions, orders).map(record => {
    const s = record.subscription;
    const upgrade = s && orders.find(o => o.kind === "upgrade" && o.status === "paid" && o.sourceSubscriptionId === s.id);
    const past = !s || ["expired","trial_canceled"].includes(s.state);
    const days = s ? Math.ceil((Date.parse(s.validTo)-now.getTime())/86400000) : NaN;
    return {...record,past,upgradedAt:upgrade?.createdAt || null,includedInEverything:past && everything && (s?.scope || s?.plan?.scope) === "category",daysLeft:!past && Number.isFinite(days) && days>=0 && days<=30 ? days : null};
  });
}

export function subscriptionPaymentType(order: Order, orders: Order[]): "trial"|"upgrade"|"renewal"|"purchase" {
  if(order.kind === "trial_activation") return "trial";
  if(order.kind === "upgrade") return "upgrade";
  return order.status === "paid" && orders.some(o => o.id!==order.id && o.status === "paid" && o.kind!=="trial_activation" && o.createdAt<order.createdAt) ? "renewal" : "purchase";
}
