import assert from "node:assert/strict";
import { test } from "node:test";
import type { LiveSessionRow, PresenceRow, StudyGroupStore } from "../../modules/group-study/domain";
import {
  closeLapsedSeats,
  EMPTY_LIVE_GRACE_MS,
  endLiveSessionIfEmpty,
  seatCount,
  seatHeld,
  SEAT_LEASE_MS,
  sweepSeats
} from "../../modules/group-study/presence";

// The seat lease (QA 2026-10-19 redesign) as pure rules over a store snapshot.

const START = Date.parse("2026-10-19T10:00:00.000Z");
const at = (ms: number) => new Date(START + ms);
const iso = (ms: number) => at(ms).toISOString();

function liveSession(overrides: Partial<LiveSessionRow> = {}): LiveSessionRow {
  return {
    id: "s-1",
    groupId: "g-1",
    title: "Lease session",
    relatedLessonId: null,
    startsAt: iso(0),
    durationSeconds: 1800,
    maxParticipants: 4,
    focus: null,
    aiTutorEnabled: false,
    liveKitProjectId: null,
    status: "live",
    startedAt: iso(0),
    completedAt: null,
    createdAt: iso(0),
    updatedAt: iso(0),
    ...overrides
  };
}

function seat(userId: string, lastSeen: number, overrides: Partial<PresenceRow> = {}): PresenceRow {
  return { id: `p-${userId}`, sessionId: "s-1", userId, requestedAt: iso(0), enteredAt: iso(0), leftAt: null, phase: "live", lastSeenAt: iso(lastSeen), ...overrides };
}

function storeWith(presences: PresenceRow[], session = liveSession()): StudyGroupStore {
  return {
    groups: [], memberships: [], sessions: [session], intents: [], presences,
    meetings: [{ id: "m-1", sessionId: session.id, startedAt: iso(0), endedAt: null }],
    tutorRequests: [], outbox: [], reminders: []
  };
}

test("a seat is held until one lease after its last renewal, and legacy rows count from entry", () => {
  const renewed = seat("u-1", 20_000);
  assert.equal(seatHeld(renewed, at(20_000 + SEAT_LEASE_MS - 1)), true);
  assert.equal(seatHeld(renewed, at(20_000 + SEAT_LEASE_MS)), false);
  const legacy = seat("u-2", 0, { lastSeenAt: undefined, enteredAt: iso(5_000) });
  assert.equal(seatHeld(legacy, at(5_000 + SEAT_LEASE_MS - 1)), true);
  assert.equal(seatHeld(legacy, at(5_000 + SEAT_LEASE_MS)), false);
  assert.equal(seatHeld(seat("u-3", 0, { enteredAt: null }), at(0)), false);
  assert.equal(seatHeld(seat("u-4", 0, { leftAt: iso(1_000) }), at(2_000)), false);
});

test("closing lapsed seats dates each one to its own lease end and leaves held seats alone", () => {
  const store = storeWith([seat("u-1", 0), seat("u-2", 50_000), seat("u-3", 10_000, { sessionId: "s-2" })]);
  assert.equal(closeLapsedSeats(store, at(60_000), "s-1"), 1);
  assert.equal(store.presences[0].leftAt, iso(SEAT_LEASE_MS));
  assert.equal(store.presences[1].leftAt, null);
  assert.equal(store.presences[2].leftAt, null, "another session is out of scope");
  assert.equal(seatCount(store, "s-1", at(60_000)), 1);
});

test("an emptied live session waits the grace period, then ends dated to the moment it emptied", () => {
  const store = storeWith([seat("u-1", 0), seat("u-2", 10_000)]);
  const emptied = 10_000 + SEAT_LEASE_MS;
  assert.deepEqual(sweepSeats(store, at(emptied + EMPTY_LIVE_GRACE_MS - 1)), { seatsClosed: 2, sessionsEnded: 0 });
  assert.equal(store.sessions[0].status, "live");
  assert.deepEqual(sweepSeats(store, at(emptied + EMPTY_LIVE_GRACE_MS)), { seatsClosed: 0, sessionsEnded: 1 });
  assert.equal(store.sessions[0].status, "completed");
  assert.equal(store.sessions[0].completedAt, iso(emptied));
  assert.equal(store.meetings[0].endedAt, iso(emptied));
});

test("an explicit last release ends the live session now; a waiting room is never ended", () => {
  const live = storeWith([seat("u-1", 0, { leftAt: iso(5_000) })]);
  assert.equal(endLiveSessionIfEmpty(live, live.sessions[0], at(5_000)), true);
  assert.equal(live.sessions[0].completedAt, iso(5_000));

  const occupied = storeWith([seat("u-1", 0), seat("u-2", 0, { leftAt: iso(5_000) })]);
  assert.equal(endLiveSessionIfEmpty(occupied, occupied.sessions[0], at(5_000)), false);

  const waiting = storeWith([seat("u-1", 0, { phase: "waiting" })], liveSession({ status: "scheduled", startedAt: null }));
  assert.deepEqual(sweepSeats(waiting, at(10 * 60_000)), { seatsClosed: 1, sessionsEnded: 0 });
  assert.equal(waiting.sessions[0].status, "scheduled");
});
