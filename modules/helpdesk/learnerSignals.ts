// Helpdesk v5 Part A (helpdesk-v5-context-chips-and-smalltalk.md, 2026-10-29):
// the learner's situation signals, worked out by code from Portal's own
// records only (the product store's user, orders and subscriptions, and the
// learner's own enquiries). Pure: no I/O, no clock of its own, nothing written.
// Each signal is true or false; no value (amount, order number, date) is kept
// or returned. They never leave Portal: Admin and the model never receive
// them; the chat log stores only their enum names.
//
// The rules use fields that exist in services/productStore.ts:
// - trial_ending: a trial subscription (source "trial") that is live (state
//   active or cancel_at_period_end) and whose validTo is within 3 days.
// - payment_failed: a purchase or trial subscription in "grace" (the store's
//   state for Stripe past_due / unpaid: "Payment requires attention") that has
//   not run out, or the learner's latest order (by createdAt) is "failed".
// - payment_pending: the latest order is "pending" and was created more than
//   10 minutes ago. ProductOrder has no separate "pending since"; createdAt is
//   when the checkout started.
// - recent_purchase: an order "paid" in the last 7 days. ProductOrder has no
//   paidAt field, so createdAt stands for it (a paid checkout completes within
//   minutes of being created; a renewal order is created when it is paid).
//   Trial activations (amount 0) count: "paid but no access" applies to them too.
// - subscription_cancelled: a purchase subscription in cancel_at_period_end
//   whose access has not ended (validTo in the future).
// - subscription_expired: no live subscription (active, cancel_at_period_end
//   or grace, validTo in the future) but the learner had one before (any state,
//   a trial included; trial_canceled ends trial access at once).
// - email_unverified: the account has an email address and emailVerifiedAt is
//   null (a WeChat account with no email bound has no address to verify).
// - open_ticket_waiting: one of the learner's own enquiries is WAITING_USER
//   ("Awaiting your reply").
// - from_order: Contact Support was opened from one of the learner's own
//   orders (v4, ?orderId= checked to be theirs by the caller).
// No signal had to be dropped: every one has the data above.
import { SITUATION_SIGNALS, type SituationSignal, type TicketStatus } from "@/contracts/helpdesk";
import type { ProductOrder, ProductSubscription, ProductUser } from "@/services/productStore";

function deepFreeze<T extends object>(value: T): Readonly<T> {
  for (const child of Object.values(value)) if (child && typeof child === "object") deepFreeze(child as object);
  return Object.freeze(value);
}

/** Every number of the signal rules, in one place. */
export const SIGNAL_RULES = deepFreeze({
  /** trial_ending: the trial ends within this long (and has not ended). */
  trialEndingWithinMs: 3 * 24 * 3_600_000,
  /** payment_pending: the latest order has been pending for more than this long. */
  paymentPendingAfterMs: 10 * 60_000,
  /** recent_purchase: an order paid within this long. */
  recentPurchaseWithinMs: 7 * 24 * 3_600_000
});

export type SignalSources = {
  now: Date;
  user: Pick<ProductUser, "email" | "emailVerifiedAt"> | null;
  orders: Array<Pick<ProductOrder, "userId" | "status" | "createdAt">>;
  subscriptions: Array<Pick<ProductSubscription, "userId" | "state" | "source" | "validTo"> & Partial<Pick<ProductSubscription, "graceEndsAt">>>;
  /** The learner's own enquiries (status only). */
  tickets: Array<{ status: TicketStatus }>;
  /** Contact Support was opened with one of the learner's own orders. */
  fromOrder: boolean;
};

const time = (iso: string | null | undefined): number => {
  const value = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(value) ? value : NaN;
};

const LIVE_STATES: ReadonlyArray<ProductSubscription["state"]> = ["active", "cancel_at_period_end", "grace"];

/** The learner's signals (only those that are true), in SITUATION_SIGNALS order. Orders and subscriptions of other users are ignored. */
export function learnerSignals(userId: string, sources: SignalSources): SituationSignal[] {
  const now = sources.now.getTime();
  const orders = sources.orders.filter((order) => order.userId === userId && Number.isFinite(time(order.createdAt)));
  const subscriptions = sources.subscriptions.filter((item) => item.userId === userId);
  // Newest first; the same createdAt keeps the store's order (newest are unshifted first).
  const latest = [...orders].sort((a, b) => time(b.createdAt) - time(a.createdAt))[0];
  const live = (item: SignalSources["subscriptions"][number]) => LIVE_STATES.includes(item.state) && time(item.state === "grace" ? item.graceEndsAt || item.validTo : item.validTo) > now;
  const on: Record<SituationSignal, boolean> = {
    trial_ending: subscriptions.some((item) => item.source === "trial" && (item.state === "active" || item.state === "cancel_at_period_end") && time(item.validTo) > now && time(item.validTo) - now <= SIGNAL_RULES.trialEndingWithinMs),
    payment_failed: subscriptions.some((item) => item.state === "grace" && live(item)) || latest?.status === "failed",
    payment_pending: latest?.status === "pending" && now - time(latest.createdAt) > SIGNAL_RULES.paymentPendingAfterMs,
    recent_purchase: orders.some((order) => order.status === "paid" && time(order.createdAt) <= now && now - time(order.createdAt) <= SIGNAL_RULES.recentPurchaseWithinMs),
    subscription_cancelled: subscriptions.some((item) => item.source === "purchase" && item.state === "cancel_at_period_end" && time(item.validTo) > now),
    subscription_expired: subscriptions.length > 0 && !subscriptions.some(live),
    email_unverified: Boolean(sources.user?.email) && !sources.user?.emailVerifiedAt,
    open_ticket_waiting: sources.tickets.some((ticket) => ticket.status === "WAITING_USER"),
    from_order: sources.fromOrder
  };
  return SITUATION_SIGNALS.filter((signal) => on[signal]);
}
