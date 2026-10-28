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
  formatTicketNumber,
  needsReply,
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
  ["CLOSED", "rate", "learner", "CLOSED"]
];
const COMMANDS: Command[] = ["cancel", "claim", "agent_reply", "internal_note", "learner_reply", "propose_resolution", "confirm", "reject", "close", "rate", "auto_confirm", "create"];
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
  const events = new Set(["created", "claimed", "agent_replied", "internal_note_added", "learner_replied", "resolution_proposed", "resolution_rejected", "confirmed", "auto_confirmed", "closed_by_learner", "cancelled", "reopened", "rated"]);
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
