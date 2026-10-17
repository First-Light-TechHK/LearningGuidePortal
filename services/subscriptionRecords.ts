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
  const at = now.getTime();
  const stateOf = (s: Subscription | null) => !s ? "unavailable" as const : ["active", "cancel_at_period_end", "grace"].includes(s.state)
    && Date.parse(s.state === "grace" ? s.graceEndsAt || s.validTo : s.validTo) <= at ? "expired" as const : s.state;
  const records = groupSubscriptionRecords(subscriptions, orders);
  const merged = new Set<string>();
  // An upgrade is the continuation of the original product's billing history.
  // Keep the original Category payment in Everything, without a duplicate past card.
  for (const target of records) {
    if ((target.subscription?.scope || target.subscription?.plan?.scope) !== "everything") continue;
    for (const upgrade of [...target.orders]) {
      if (upgrade.kind !== "upgrade" || upgrade.status !== "paid" || !upgrade.sourceSubscriptionId) continue;
      const source = records.find(row => row.subscription?.id === upgrade.sourceSubscriptionId);
      if (!source || source === target) continue;
      target.orders.push(...source.orders.filter(order => !target.orders.some(existing => existing.id === order.id)));
      merged.add(source.id);
    }
  }
  // Re-purchasing the same product adds history to its newest live subscription.
  // Term changes do not create a second product card.
  const products = new Map<string, SubscriptionProductRecord>();
  for (const row of records.filter(row => !merged.has(row.id))) {
    const s = row.subscription, scope = s?.scope || s?.plan?.scope;
    const scopeId = s?.scopeId || s?.plan?.scopeId || s?.plan?.category;
    const key = s && scope && (scope === "everything" || scopeId) ? `${s.source}:${s.device || "pc"}:${scope}:${scope === "everything" ? "*" : scopeId}` : row.id;
    const existing = products.get(key);
    if (!existing) { products.set(key, { ...row, orders: [...row.orders] }); continue; }
    const isLive = (item: SubscriptionProductRecord) => ["active", "cancel_at_period_end", "grace"].includes(stateOf(item.subscription));
    // Legacy overlapping billing contracts must each keep a management action.
    if (isLive(row) && isLive(existing) && s?.stripeSubscriptionId && existing.subscription?.stripeSubscriptionId
      && s.stripeSubscriptionId !== existing.subscription.stripeSubscriptionId) {
      products.set(`${key}:${row.id}`, { ...row, orders: [...row.orders] }); continue;
    }
    const newest = isLive(row) && !isLive(existing) || isLive(row) === isLive(existing)
      && Date.parse(s!.validTo) > Date.parse(existing.subscription!.validTo);
    products.set(key, { ...(newest ? row : existing), orders: [...existing.orders, ...row.orders] });
  }
  return [...products.values()].map(record => {
    const s = record.subscription, displayState = stateOf(s);
    const past = !["active", "cancel_at_period_end", "grace"].includes(displayState);
    const days = s ? Math.ceil((Date.parse(s.validTo) - at) / 86400000) : NaN;
    return { ...record, orders: record.orders.sort((a, b) => b.createdAt.localeCompare(a.createdAt)), displayState, past,
      upgradedAt: null, includedInEverything: false, daysLeft: !past && Number.isFinite(days) && days >= 0 && days <= 30 ? days : null };
  });
}

export function subscriptionPaymentType(order: Order, orders: Order[]): "trial"|"upgrade"|"renewal"|"purchase" {
  if(order.kind === "trial_activation") return "trial";
  if(order.kind === "upgrade") return "upgrade";
  return order.status === "paid" && orders.some(o => o.id!==order.id && o.status === "paid" && o.kind!=="trial_activation" && o.createdAt<order.createdAt) ? "renewal" : "purchase";
}
