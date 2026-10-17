export const subscriptionCancelReasons = ["low_usage", "too_expensive", "content", "website", "other"] as const;
export type SubscriptionCancelReason = typeof subscriptionCancelReasons[number];
export type SubscriptionChange = { subscriptionId: string; action: "cancel" | "resume"; reasonCode?: SubscriptionCancelReason; reasonText?: string };
export type SubscriptionRenewalChange = SubscriptionChange & { id: string; completed: boolean };
export class SubscriptionManagementError extends Error {
  constructor(public readonly code: "invalid" | "not_found" | "expired" | "resume_unavailable" | "change_pending" | "provider_unavailable", public readonly status = 400) { super(code); }
}
export function parseSubscriptionChange(value: unknown): SubscriptionChange {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SubscriptionManagementError("invalid");
  const body = value as Record<string, unknown>;
  if (typeof body.subscriptionId !== "string" || !body.subscriptionId || body.subscriptionId.length > 200 || !["cancel", "resume"].includes(String(body.action))) throw new SubscriptionManagementError("invalid");
  if (body.reasonCode !== undefined && !subscriptionCancelReasons.includes(body.reasonCode as SubscriptionCancelReason)
    || body.reasonText !== undefined && (typeof body.reasonText !== "string" || body.reasonText.length > 500)) throw new SubscriptionManagementError("invalid");
  return { subscriptionId: body.subscriptionId, action: body.action as SubscriptionChange["action"], reasonCode: body.action === "cancel" ? body.reasonCode as SubscriptionCancelReason | undefined : undefined,
    reasonText: body.action === "cancel" && body.reasonCode === "other" ? (body.reasonText as string | undefined)?.trim() : undefined };
}
