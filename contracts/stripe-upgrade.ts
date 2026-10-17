// Stripe's invoice preview, pinned to the original subscription period.
export type StripeUpgradeProration = {
  subscriptionId: string;
  customerId: string;
  itemId: string;
  sourcePriceId: string;
  prorationDate: number;
  periodStart: number;
  periodEnd: number;
  billingCycleAnchor: number;
  debitMinor: number;
  creditMinor: number;
  adjustmentsMinor: number;
  invoiceTotalMinor: number;
  amountDueMinor: number;
};

export type UpgradeQuoteDisplay = {
  id: string; amountMinor: number; currency: string; expiresAt: string;
  upgradeProration: StripeUpgradeProration;
};

// All identities come from the caller-owned, paid local Order/Subscription.
export type LegacyStripeUpgradeSource = {
  checkoutSessionId: string; orderId: string; userId: string; planId: string;
  subscriptionId: string; customerId: string; amountMinor: number; currency: string;
};
