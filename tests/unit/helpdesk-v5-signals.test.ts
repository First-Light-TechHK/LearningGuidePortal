// Helpdesk v5 Part A (helpdesk-v5-context-chips-and-smalltalk.md): the
// learner's situation signals (code only, from Portal's own records) and the
// situation chips chosen from them. Each rule is locked at its boundaries.
import assert from "node:assert/strict";
import { test } from "node:test";
import { FAQ_SIGNALS, SITUATION_SIGNALS, type FaqSignal } from "../../contracts/helpdesk";
import { SIGNAL_RULES, learnerSignals, type SignalSources } from "../../modules/helpdesk/learnerSignals";
import { SITUATION_CHIPS_MAX, chooseSituationChips, waitingTicketOf, type ChipCandidate } from "../../modules/helpdesk/situationChips";

const NOW = new Date("2026-10-29T12:00:00.000Z");
const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ME = "user_me";

function sources(overrides: Partial<SignalSources> = {}): SignalSources {
  return { now: NOW, user: { email: "me@example.test", emailVerifiedAt: at(-30 * DAY) }, orders: [], subscriptions: [], tickets: [], fromOrder: false, ...overrides };
}
const order = (status: "paid" | "pending" | "failed" | "canceled" | "refunded", createdAt: string, userId = ME) => ({ userId, status, createdAt });
const sub = (state: "active" | "cancel_at_period_end" | "grace" | "expired" | "trial_canceled", source: "trial" | "purchase", validTo: string, extra: { graceEndsAt?: string | null; userId?: string } = {}) => ({ userId: extra.userId ?? ME, state, source, validTo, graceEndsAt: extra.graceEndsAt ?? null });
const signals = (overrides: Partial<SignalSources>) => learnerSignals(ME, sources(overrides));

test("v5 signals: the rule numbers are one frozen object with the spec's values; a learner with nothing going on has no signal", () => {
  assert.equal(SIGNAL_RULES.trialEndingWithinMs, 3 * DAY);
  assert.equal(SIGNAL_RULES.paymentPendingAfterMs, 10 * MIN);
  assert.equal(SIGNAL_RULES.recentPurchaseWithinMs, 7 * DAY);
  assert.ok(Object.isFrozen(SIGNAL_RULES));
  assert.deepEqual(signals({}), []);
  assert.deepEqual(learnerSignals(ME, sources({ user: null })), [], "no account record: nothing");
});

test("v5 signals: trial_ending is a live trial ending within 3 days (not one already over, not a purchase)", () => {
  assert.deepEqual(signals({ subscriptions: [sub("active", "trial", at(3 * DAY))] }), ["trial_ending"], "exactly 3 days left");
  assert.deepEqual(signals({ subscriptions: [sub("active", "trial", at(3 * DAY + 1))] }), [], "a moment more than 3 days");
  assert.deepEqual(signals({ subscriptions: [sub("active", "trial", at(1))] }), ["trial_ending"]);
  assert.deepEqual(signals({ subscriptions: [sub("cancel_at_period_end", "trial", at(DAY))] }), ["trial_ending"]);
  assert.ok(!signals({ subscriptions: [sub("active", "trial", at(0))] }).includes("trial_ending"), "ended at this moment");
  assert.deepEqual(signals({ subscriptions: [sub("active", "purchase", at(DAY))] }), [], "a paid plan renewing soon is not a trial");
});

test("v5 signals: payment_failed is a subscription in grace (past due) that has not run out, or a failed latest order", () => {
  assert.deepEqual(signals({ subscriptions: [sub("grace", "purchase", at(DAY), { graceEndsAt: at(DAY) })] }), ["payment_failed"]);
  assert.deepEqual(signals({ subscriptions: [sub("grace", "trial", at(DAY))] }), ["payment_failed"], "a trial in grace too (grace is not a live trial ending)");
  assert.deepEqual(signals({ subscriptions: [sub("grace", "purchase", at(-1), { graceEndsAt: at(-1) })] }), ["subscription_expired"], "grace that ran out is an ended plan");
  assert.deepEqual(signals({ orders: [order("failed", at(-HOUR))] }), ["payment_failed"]);
  assert.deepEqual(signals({ orders: [order("failed", at(-2 * HOUR)), order("paid", at(-HOUR))] }), ["recent_purchase"], "only the latest order counts");
  assert.deepEqual(signals({ orders: [order("paid", at(-2 * HOUR)), order("failed", at(-HOUR))] }), ["payment_failed", "recent_purchase"]);
  assert.deepEqual(signals({ orders: [order("failed", at(-HOUR), "someone_else")] }), [], "another learner's order is ignored");
});

test("v5 signals: payment_pending is a latest order pending for more than 10 minutes", () => {
  assert.deepEqual(signals({ orders: [order("pending", at(-10 * MIN))] }), [], "exactly 10 minutes is not more than 10");
  assert.deepEqual(signals({ orders: [order("pending", at(-10 * MIN - 1))] }), ["payment_pending"]);
  assert.deepEqual(signals({ orders: [order("pending", at(-HOUR)), order("paid", at(-MIN))] }), ["recent_purchase"], "a newer paid order wins");
});

test("v5 signals: recent_purchase is an order paid in the last 7 days (createdAt; the store has no paid time)", () => {
  assert.deepEqual(signals({ orders: [order("paid", at(-7 * DAY))] }), ["recent_purchase"], "exactly 7 days");
  assert.deepEqual(signals({ orders: [order("paid", at(-7 * DAY - 1))] }), []);
  assert.deepEqual(signals({ orders: [order("refunded", at(-DAY))] }), [], "a refunded order is not a purchase");
  assert.deepEqual(signals({ orders: [order("paid", "not a date")] }), [], "a malformed time is ignored");
});

test("v5 signals: subscription_cancelled is a purchase cancelled at the period end with access left; subscription_expired is no live plan after having one", () => {
  assert.deepEqual(signals({ subscriptions: [sub("cancel_at_period_end", "purchase", at(DAY))] }), ["subscription_cancelled"]);
  assert.deepEqual(signals({ subscriptions: [sub("cancel_at_period_end", "purchase", at(-1))] }), ["subscription_expired"], "its access ended");
  assert.deepEqual(signals({ subscriptions: [sub("expired", "purchase", at(-DAY))] }), ["subscription_expired"]);
  assert.deepEqual(signals({ subscriptions: [sub("trial_canceled", "trial", at(DAY))] }), ["subscription_expired"], "a cancelled trial ends access at once");
  assert.deepEqual(signals({ subscriptions: [sub("expired", "trial", at(-DAY)), sub("active", "purchase", at(30 * DAY))] }), [], "a live plan now: not expired");
  assert.deepEqual(signals({ subscriptions: [sub("active", "purchase", at(-1))] }), ["subscription_expired"], "an active row whose period is over (not yet swept) has ended");
  assert.deepEqual(signals({ subscriptions: [sub("expired", "purchase", at(-DAY), { userId: "someone_else" })] }), []);
});

test("v5 signals: email_unverified, open_ticket_waiting and from_order", () => {
  assert.deepEqual(signals({ user: { email: "me@example.test", emailVerifiedAt: null } }), ["email_unverified"]);
  assert.deepEqual(signals({ user: { email: null, emailVerifiedAt: null } }), [], "no email bound (WeChat): nothing to verify");
  assert.deepEqual(signals({ tickets: [{ status: "WAITING_USER" }] }), ["open_ticket_waiting"]);
  assert.deepEqual(signals({ tickets: [{ status: "OPEN" }, { status: "PENDING_CONFIRM" }, { status: "CLOSED" }] }), [], "only an enquiry awaiting the learner's reply");
  assert.deepEqual(signals({ fromOrder: true }), ["from_order"]);
});

test("v5 signals: the result is in the contract's order, enum names only (no values)", () => {
  const all = signals({
    user: { email: "me@example.test", emailVerifiedAt: null }, fromOrder: true, tickets: [{ status: "WAITING_USER" }],
    orders: [order("paid", at(-DAY)), order("pending", at(-HOUR))],
    subscriptions: [sub("active", "trial", at(DAY)), sub("grace", "purchase", at(DAY), { graceEndsAt: at(DAY) }), sub("cancel_at_period_end", "purchase", at(DAY))]
  });
  assert.deepEqual(all, ["trial_ending", "payment_failed", "payment_pending", "recent_purchase", "subscription_cancelled", "email_unverified", "open_ticket_waiting", "from_order"]);
  assert.deepEqual(all, SITUATION_SIGNALS.filter((signal) => all.includes(signal)));
  for (const value of all) assert.equal(typeof value, "string");
});

// ---------------------------------------------------------------- chips

const faq = (n: number, signals: FaqSignal[] = [], popular = false): ChipCandidate => ({ id: `01a18100-0000-7000-8000-${String(n).padStart(12, "0")}`, question: `Question ${n}`, popular, signals });

test("v5 chips: signal-matched FAQs first, by signal priority, then popular ones fill up to 4; each once; the same inputs give the same chips", () => {
  assert.equal(SITUATION_CHIPS_MAX, 4);
  assert.deepEqual([...FAQ_SIGNALS], ["payment_failed", "payment_pending", "recent_purchase", "trial_ending", "subscription_expired", "subscription_cancelled", "email_unverified", "from_order"]);
  const list = [faq(1, [], true), faq(2, ["trial_ending"]), faq(3, ["payment_failed"]), faq(4, ["recent_purchase", "payment_failed"], true), faq(5, [], true), faq(6, [], true), faq(7, ["email_unverified"])];
  const chosen = chooseSituationChips(["trial_ending", "payment_failed", "email_unverified"], list);
  assert.deepEqual(chosen.chips.map((chip) => [chip.question, chip.reason]), [["Question 3", "signal"], ["Question 4", "signal"], ["Question 2", "signal"], ["Question 7", "signal"]], "payment_failed (in list order), then trial_ending, then email_unverified");
  assert.equal(chosen.situational, true);
  assert.deepEqual(chosen.matched, ["payment_failed", "trial_ending", "email_unverified"]);
  assert.deepEqual(chooseSituationChips(["trial_ending", "payment_failed", "email_unverified"], list), chosen, "stable");
  const fill = chooseSituationChips(["recent_purchase"], list);
  assert.deepEqual(fill.chips.map((chip) => [chip.question, chip.reason]), [["Question 4", "signal"], ["Question 1", "popular"], ["Question 5", "popular"], ["Question 6", "popular"]], "popular fill skips the chip already shown");
  const none = chooseSituationChips([], list);
  assert.deepEqual(none.chips.map((chip) => chip.reason), ["popular", "popular", "popular", "popular"]);
  assert.equal(none.situational, false, "no signal matched: the 'Try asking' title");
  assert.deepEqual(chooseSituationChips(["open_ticket_waiting"], list).matched, [], "open_ticket_waiting is a card, never an FAQ chip");
  assert.deepEqual(chooseSituationChips([], []).chips, []);
  assert.equal(chooseSituationChips(["payment_failed"], [faq(9, ["payment_failed"]), { ...faq(9, ["payment_failed"]), question: "Dup" }]).chips.length, 1, "an id once");
  assert.equal(chooseSituationChips([], [faq(1, [], true), faq(2, [], true)], 1).chips.length, 1, "the cap");
});

test("v5 chips: the chip text is the FAQ question as written; the waiting-enquiry card is the newest WAITING_USER enquiry", () => {
  const chosen = chooseSituationChips(["payment_failed"], [{ ...faq(1, ["payment_failed"]), id: faq(1).id.toUpperCase() }]);
  assert.deepEqual(chosen.chips, [{ id: faq(1).id, question: "Question 1", reason: "signal" }]);
  const tickets = [
    { id: "t1", number: "LG-261028-0001", status: "WAITING_USER" as const, updatedAt: "2026-10-28T10:00:00.000Z" },
    { id: "t2", number: "LG-261029-0002", status: "WAITING_USER" as const, updatedAt: "2026-10-29T10:00:00.000Z" },
    { id: "t3", number: "LG-261029-0003", status: "ASSIGNED" as const, updatedAt: "2026-10-29T11:00:00.000Z" }
  ];
  assert.deepEqual(waitingTicketOf(tickets), { id: "t2", number: "LG-261029-0002" });
  assert.equal(waitingTicketOf(tickets.filter((ticket) => ticket.status !== "WAITING_USER")), null);
});
