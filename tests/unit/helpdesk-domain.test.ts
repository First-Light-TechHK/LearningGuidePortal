import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CONFIRM_WINDOW_HOURS,
  EVENT_TYPE_PREFIX,
  REOPEN_WINDOW_DAYS,
  TRANSITIONS,
  confirmDueAt,
  decide,
  eventType,
  evolve,
  isLearnerVisibleEvent,
  ignoredByStaleCheck,
  type TicketRecord,
  formatTicketNumber,
  needsReply,
  raisesUnreadByAgent,
  reopenDeadline,
  ticketDayKey,
  type Command,
  type TicketState
} from "../../modules/helpdesk/domain";
import { TICKET_STATUSES, type TicketStatus } from "../../contracts/helpdesk";
import { isUuid, uuidv7, uuidv7Timestamp } from "../../lib/uuidv7";

const NOW = new Date("2026-10-28T06:00:00.000Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function state(status: TicketStatus, overrides: Partial<TicketState> = {}): TicketState {
  const closed = status === "CLOSED" || status === "CANCELLED";
  return {
    status,
    assigneeId: status === "OPEN" ? null : "agent-1",
    confirmDueAt: status === "PENDING_CONFIRM" ? new Date(NOW.getTime() + HOUR).toISOString() : null,
    closedAt: closed ? new Date(NOW.getTime() - DAY).toISOString() : null,
    rating: null,
    ...overrides
  };
}

// The spec §2 table, written out independently of the implementation:
// [from, command, actor] -> to ("same" = unchanged). Everything else is rejected.
const ALLOWED: Array<[TicketStatus, Command, "learner" | "agent" | "system", TicketStatus]> = [
  ["OPEN", "cancel", "learner", "CANCELLED"],
  ["OPEN", "claim", "agent", "ASSIGNED"],
  ["OPEN", "agent_reply", "agent", "WAITING_USER"],
  ["ASSIGNED", "agent_reply", "agent", "WAITING_USER"],
  ["WAITING_USER", "agent_reply", "agent", "WAITING_USER"],
  ["OPEN", "internal_note", "agent", "OPEN"],
  ["ASSIGNED", "internal_note", "agent", "ASSIGNED"],
  ["WAITING_USER", "internal_note", "agent", "WAITING_USER"],
  ["PENDING_CONFIRM", "internal_note", "agent", "PENDING_CONFIRM"],
  ["CLOSED", "internal_note", "agent", "CLOSED"],
  ["WAITING_USER", "learner_reply", "learner", "ASSIGNED"],
  ["OPEN", "learner_reply", "learner", "OPEN"],
  ["ASSIGNED", "learner_reply", "learner", "ASSIGNED"],
  ["ASSIGNED", "propose_resolution", "agent", "PENDING_CONFIRM"],
  ["WAITING_USER", "propose_resolution", "agent", "PENDING_CONFIRM"],
  ["PENDING_CONFIRM", "confirm", "learner", "CLOSED"],
  ["PENDING_CONFIRM", "reject", "learner", "ASSIGNED"],
  ["PENDING_CONFIRM", "learner_reply", "learner", "ASSIGNED"],
  ["ASSIGNED", "close", "learner", "CLOSED"],
  ["WAITING_USER", "close", "learner", "CLOSED"],
  ["CLOSED", "learner_reply", "learner", "ASSIGNED"],
  ["CLOSED", "rate", "learner", "CLOSED"],
  // Addendum §B/§D: a declined AI suggestion is recorded right after create;
  // agents may tag a ticket in any state (the state never changes).
  ["OPEN", "decline_suggestion", "learner", "OPEN"],
  ...TICKET_STATUSES.flatMap((status) => [[status, "add_tag", "agent", status], [status, "remove_tag", "agent", status]] as Array<[TicketStatus, Command, "agent", TicketStatus]>)
];
const COMMANDS: Command[] = ["cancel", "claim", "agent_reply", "internal_note", "learner_reply", "propose_resolution", "confirm", "reject", "close", "rate", "auto_confirm", "create", "decline_suggestion", "add_tag", "remove_tag"];
const ACTORS = ["learner", "agent", "system"] as const;

test("every allowed transition in the spec table reaches its target state", () => {
  for (const [from, command, actor, to] of ALLOWED) {
    const decision = decide(state(from), command, actor, NOW);
    assert.equal(decision.ok, true, `${from} ${command} by ${actor} must be allowed`);
    if (decision.ok) assert.equal(decision.to, to, `${from} ${command} by ${actor}`);
  }
  const due = decide(state("PENDING_CONFIRM", { confirmDueAt: new Date(NOW.getTime() - 1).toISOString() }), "auto_confirm", "system", NOW);
  assert.ok(due.ok && due.to === "CLOSED" && due.transition.closeReason === "auto_confirmed");
  const created = decide(null, "create", "learner", NOW);
  assert.ok(created.ok && created.to === "OPEN" && created.transition.event === "created");
});

test("every combination outside the table is rejected with invalid_transition", () => {
  const allowed = new Set(ALLOWED.map(([from, command, actor]) => `${from}|${command}|${actor}`));
  let rejected = 0;
  for (const from of TICKET_STATUSES) {
    for (const command of COMMANDS) {
      for (const actor of ACTORS) {
        if (allowed.has(`${from}|${command}|${actor}`)) continue;
        if (from === "PENDING_CONFIRM" && command === "auto_confirm" && actor === "system") continue;
        const decision = decide(state(from), command, actor, NOW);
        assert.equal(decision.ok, false, `${from} ${command} by ${actor} must be rejected`);
        if (!decision.ok) assert.equal(decision.code, "invalid_transition", `${from} ${command} by ${actor}`);
        rejected += 1;
      }
    }
  }
  assert.ok(rejected > 150);
  // representative forbidden cases called out explicitly
  for (const [from, command, actor] of [["CANCELLED", "learner_reply", "learner"], ["OPEN", "propose_resolution", "agent"], ["PENDING_CONFIRM", "agent_reply", "agent"], ["CLOSED", "agent_reply", "agent"], ["ASSIGNED", "claim", "agent"], ["OPEN", "claim", "learner"], ["ASSIGNED", "cancel", "learner"], ["OPEN", "close", "learner"], ["OPEN", "create", "learner"]] as const) {
    const decision = decide(state(from), command, actor, NOW);
    assert.ok(!decision.ok && decision.code === "invalid_transition", `${from} ${command}`);
  }
});

test("the transition table is the single source: each row names an event and a valid target", () => {
  const events = new Set(["created", "claimed", "agent_replied", "internal_note_added", "learner_replied", "resolution_proposed", "resolution_rejected", "confirmed", "auto_confirmed", "closed_by_learner", "cancelled", "reopened", "rated", "suggestion_declined", "tag_added", "tag_removed", "flagged", "unflagged"]);
  for (const row of TRANSITIONS) {
    assert.ok(events.has(row.event), row.event);
    assert.ok(row.to === "unchanged" || TICKET_STATUSES.includes(row.to));
  }
  assert.deepEqual(new Set(TRANSITIONS.map((row) => row.event)), events);
  assert.equal(eventType("created"), "com.ilovelearningguide.helpdesk.ticket.created");
  assert.equal(EVENT_TYPE_PREFIX, "com.ilovelearningguide.helpdesk.ticket.");
});

test("close reasons follow the spec", () => {
  const reason = (from: TicketStatus, command: Command, actor: "learner" | "agent" | "system", overrides: Partial<TicketState> = {}) => {
    const decision = decide(state(from, overrides), command, actor, NOW);
    assert.ok(decision.ok);
    return decision.transition.closeReason;
  };
  assert.equal(reason("OPEN", "cancel", "learner"), "cancelled");
  assert.equal(reason("PENDING_CONFIRM", "confirm", "learner"), "user_confirmed");
  assert.equal(reason("ASSIGNED", "close", "learner"), "user_closed");
  assert.equal(reason("PENDING_CONFIRM", "auto_confirm", "system", { confirmDueAt: NOW.toISOString() }), "auto_confirmed");
  const reopen = decide(state("CLOSED"), "learner_reply", "learner", NOW);
  assert.ok(reopen.ok && reopen.transition.event === "reopened");
});

test("72-hour confirmation window: auto_confirm only once the due time has passed", () => {
  assert.equal(CONFIRM_WINDOW_HOURS, 72);
  assert.equal(confirmDueAt(NOW), new Date(NOW.getTime() + 72 * HOUR).toISOString());
  const notYet = decide(state("PENDING_CONFIRM", { confirmDueAt: new Date(NOW.getTime() + 1).toISOString() }), "auto_confirm", "system", NOW);
  assert.ok(!notYet.ok && notYet.code === "invalid_transition");
  const exactly = decide(state("PENDING_CONFIRM", { confirmDueAt: NOW.toISOString() }), "auto_confirm", "system", NOW);
  assert.ok(exactly.ok);
});

test("7-day reopen and rating window after close", () => {
  assert.equal(REOPEN_WINDOW_DAYS, 7);
  const closedAt = new Date(NOW.getTime() - 7 * DAY);
  assert.equal(reopenDeadline(closedAt.toISOString()), NOW.toISOString());
  const inside = decide(state("CLOSED", { closedAt: new Date(NOW.getTime() - 7 * DAY + 1).toISOString() }), "learner_reply", "learner", NOW);
  assert.ok(inside.ok && inside.to === "ASSIGNED");
  const outside = decide(state("CLOSED", { closedAt: new Date(NOW.getTime() - 7 * DAY - 1).toISOString() }), "learner_reply", "learner", NOW);
  assert.ok(!outside.ok && outside.code === "reopen_window_passed");
  const lateRating = decide(state("CLOSED", { closedAt: new Date(NOW.getTime() - 8 * DAY).toISOString() }), "rate", "learner", NOW);
  assert.ok(!lateRating.ok && lateRating.code === "rating_window_passed");
  const twice = decide(state("CLOSED", { rating: 4 }), "rate", "learner", NOW);
  assert.ok(!twice.ok && twice.code === "already_rated");
});

test("the 7-day window includes its last millisecond: reopen and rate at exactly closedAt + 7 days, refused 1 ms later", () => {
  const closedAt = new Date(NOW.getTime() - 7 * DAY).toISOString();
  const atDeadline = decide(state("CLOSED", { closedAt }), "learner_reply", "learner", NOW);
  assert.ok(atDeadline.ok && atDeadline.transition.event === "reopened");
  assert.ok(decide(state("CLOSED", { closedAt }), "rate", "learner", NOW).ok);
  const after = new Date(NOW.getTime() + 1);
  const late = decide(state("CLOSED", { closedAt }), "learner_reply", "learner", after);
  assert.ok(!late.ok && late.code === "reopen_window_passed");
  const lateRate = decide(state("CLOSED", { closedAt }), "rate", "learner", after);
  assert.ok(!lateRate.ok && lateRate.code === "rating_window_passed");
});

test("ticket numbers use the UTC day and a zero-padded per-day counter", () => {
  assert.equal(ticketDayKey(new Date("2026-10-28T23:59:59.999Z")), "261028");
  assert.equal(ticketDayKey(new Date("2026-10-28T16:30:00.000-08:00")), "261029");
  assert.equal(formatTicketNumber("2026-10-28T06:00:00.000Z", 42), "LG-261028-0042");
  assert.equal(formatTicketNumber("2026-01-02T00:00:00.000Z", 1), "LG-260102-0001");
  assert.equal(formatTicketNumber("2026-01-02T00:00:00.000Z", 12345), "LG-260102-12345");
  assert.match(formatTicketNumber(NOW.toISOString(), 7), /^LG-\d{6}-\d{4,}$/);
});

test("needs reply = OPEN or ASSIGNED whose last public message is from the learner", () => {
  assert.equal(needsReply({ status: "OPEN", lastMessageBy: "learner" }), true);
  assert.equal(needsReply({ status: "ASSIGNED", lastMessageBy: "learner" }), true);
  assert.equal(needsReply({ status: "ASSIGNED", lastMessageBy: "agent" }), false);
  assert.equal(needsReply({ status: "WAITING_USER", lastMessageBy: "learner" }), false);
  assert.equal(needsReply({ status: "PENDING_CONFIRM", lastMessageBy: "learner" }), false);
});

test("UUIDv7 (RFC 9562): version 7, RFC variant, embedded millisecond time, monotonic order", () => {
  const at = Date.parse("2026-10-28T06:00:00.123Z");
  const id = uuidv7(at);
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(uuidv7Timestamp(id), at);
  const ids = Array.from({ length: 2000 }, () => uuidv7(at));
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual([...ids].sort(), ids, "ids generated in the same millisecond still sort in creation order");
  const later = uuidv7(at + 1);
  assert.ok(later > ids[ids.length - 1]);
  assert.ok(isUuid(id) && isUuid("8e03978e-40d5-43e8-bc93-6894a57f9324") && !isUuid("../etc") && !isUuid("8e03978e40d543e8bc936894a57f9324"));
});

function record(overrides: Partial<TicketRecord> = {}): TicketRecord {
  const at = "2026-10-28T05:00:00.000Z";
  return {
    id: "0192d4f0-7b6a-7c3e-9a10-1234567890ab", number: "LG-261028-0001", userId: "u1", userEmail: "u1@example.test", userName: "U One", contactEmail: "contact@example.test",
    locale: "en-GB", category: "technical_support", subject: "s", status: "ASSIGNED", assigneeId: "agent-1", assigneeName: "Amy", sequence: 3,
    confirmDueAt: null, closedAt: null, closeReason: null, rating: null, createdAt: at, updatedAt: at, lastMessageAt: at, lastMessageBy: "agent",
    clientEventId: "8e03978e-40d5-43e8-bc93-6894a57f9324", payloadHash: "a".repeat(64), suggestionId: null, unreadByAgent: false, flaggedAt: null, flaggedBy: null, orderId: null, ...overrides
  };
}

test("unread by agent: a learner message sets it; agent commands and tags never touch it", () => {
  const ticket = record();
  const learnerReply = decide(ticket, "learner_reply", "learner", NOW);
  assert.ok(learnerReply.ok);
  assert.equal(evolve(ticket, learnerReply, { now: NOW, actor: { kind: "learner", id: "u1", name: "U" }, publicMessage: true }).unreadByAgent, true);
  const confirmLike = decide(record({ status: "ASSIGNED" }), "close", "learner", NOW);
  assert.ok(confirmLike.ok);
  assert.equal(evolve(ticket, confirmLike, { now: NOW, actor: { kind: "learner", id: "u1", name: "U" }, publicMessage: false }).unreadByAgent, false, "an action without a message is not a new message");
  const agentReply = decide(record({ unreadByAgent: true }), "agent_reply", "agent", NOW);
  assert.ok(agentReply.ok);
  assert.equal(evolve(record({ unreadByAgent: true }), agentReply, { now: NOW, actor: { kind: "agent", id: "a", name: "A" }, publicMessage: true }).unreadByAgent, true, "only mark_read clears it");
});

test("'Not yet' (reject) without a message is learner activity: unread for the agent and back in Needs reply", () => {
  const pending = record({ status: "PENDING_CONFIRM", confirmDueAt: new Date(NOW.getTime() + HOUR).toISOString(), lastMessageBy: "agent", unreadByAgent: false });
  const decision = decide(pending, "reject", "learner", NOW);
  assert.ok(decision.ok);
  const next = evolve(pending, decision, { now: NOW, actor: { kind: "learner", id: "u1", name: "U" }, publicMessage: false });
  assert.equal(next.status, "ASSIGNED");
  assert.equal(next.unreadByAgent, true);
  assert.equal(next.lastMessageBy, "learner");
  assert.equal(next.lastMessageAt, NOW.toISOString());
  assert.equal(needsReply(next), true);
  assert.equal(raisesUnreadByAgent(decision.transition, "learner", false), true);
  assert.equal(raisesUnreadByAgent(decision.transition, "learner", true), true);
  const close = decide(record(), "close", "learner", NOW);
  assert.ok(close.ok);
  assert.equal(raisesUnreadByAgent(close.transition, "learner", false), false, "closing is not a request for a reply");
  const reply = decide(record(), "agent_reply", "agent", NOW);
  assert.ok(reply.ok);
  assert.equal(raisesUnreadByAgent(reply.transition, "agent", true), false);
});

test("tags and declined suggestions are bookkeeping: state, activity time and last message stay as they were", () => {
  const ticket = record({ status: "CLOSED", closedAt: NOW.toISOString(), closeReason: "user_closed" });
  for (const command of ["add_tag", "remove_tag"] as const) {
    const decision = decide(ticket, command, "agent", NOW);
    assert.ok(decision.ok, command);
    const next = evolve(ticket, decision, { now: NOW, actor: { kind: "agent", id: "a", name: "A" }, publicMessage: false });
    assert.equal(next.status, "CLOSED");
    assert.equal(next.sequence, ticket.sequence + 1);
    assert.equal(next.updatedAt, ticket.updatedAt);
    assert.equal(next.closedAt, ticket.closedAt);
    assert.equal(next.closeReason, "user_closed");
  }
  assert.equal(decide(ticket, "add_tag", "learner", NOW).ok, false);
});

test("learner-visible events and the learner stale check: private agent bookkeeping never makes a learner's page stale", () => {
  for (const name of ["internal_note_added", "tag_added", "tag_removed", "suggestion_declined"] as const) assert.equal(isLearnerVisibleEvent(name), false, name);
  for (const name of ["created", "claimed", "agent_replied", "learner_replied", "resolution_proposed", "confirmed", "rated", "reopened"] as const) assert.equal(isLearnerVisibleEvent(name), true, name);
  assert.equal(ignoredByStaleCheck("internal_note_added", "learner"), true);
  assert.equal(ignoredByStaleCheck("tag_added", "learner"), true);
  assert.equal(ignoredByStaleCheck("tag_removed", "agent"), true, "tags never make anyone stale");
  assert.equal(ignoredByStaleCheck("internal_note_added", "agent"), false, "agents must see a colleague's new note");
  assert.equal(ignoredByStaleCheck("agent_replied", "learner"), false);
  assert.equal(ignoredByStaleCheck("claimed", "learner"), false);
});
