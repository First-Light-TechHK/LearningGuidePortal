// Presentation only: purchase dates are estimates; Stripe owns the paid period.
export type SubscriptionConfirmationDisplay = {
  planKind: "category" | "everything" | "course";
  categoryCount: number;
  schedule: { startsAt: string; endsAt: string; renewsAt: string } | null;
  upgrade: {
    sourceCategory: string;
    sourceAiPoints: number;
    validUntil: string;
    renewsAt: string;
    remainingDays: number | null;
  } | null;
};
