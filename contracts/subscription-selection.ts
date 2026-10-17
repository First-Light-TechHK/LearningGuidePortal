export type SubscriptionSelectionState = {
  kind: "none" | "one_category" | "two_categories" | "all_categories" | "everything";
  ownedCategoryIds: string[];
  categoryRenewals: boolean;
  categorySubscription: { id: string; validTo: string; remainingDays: number; canUpgrade: boolean; aiPoints: number; termMonths: 6 | 12 } | null;
  everything: { validTo: string; renewal: boolean; paymentPending: boolean; amountMinor: number | null; currency: string } | null;
};
