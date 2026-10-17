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
