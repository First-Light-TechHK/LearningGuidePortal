// Scoped Study Group reads and the history prune (backend review 2026-11-03
// H2): the scope rule (domain.ts) and the file adapter, which filters exactly
// what the PostgreSQL adapter selects so the whole unit suite proves every
// scoped service call needs nothing outside its scope.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { emptyStore, mergeScopedRows, scopeStore, type StudyGroupStore } from "../../modules/group-study/domain";
import { createStudyGroupRepository, type StudyGroupRepository } from "../../modules/group-study/repository";

const AT = "2026-11-03T10:00:00.000Z";
let directory: string;
let repository: StudyGroupRepository;

function fixture(): StudyGroupStore {
  const store = emptyStore();
  const group = (id: string, host: string) => ({ id, title: id, courseId: "course-1", about: "", hostUserId: host, status: "active" as const, createdAt: AT, updatedAt: AT });
  const session = (id: string, groupId: string, status: "scheduled" | "live" | "completed" = "live") => ({ id, groupId, title: id, relatedLessonId: null, startsAt: AT, durationSeconds: 1800, maxParticipants: 4, focus: null, aiTutorEnabled: true, liveKitProjectId: null, status, startedAt: status === "scheduled" ? null : AT, completedAt: null, createdAt: AT, updatedAt: AT });
  const presence = (sessionId: string, userId: string, left = false) => ({ id: `p-${sessionId}-${userId}`, sessionId, userId, requestedAt: `${AT}#00000001`, enteredAt: AT, lastSeenAt: AT, leftAt: left ? AT : null, phase: "live" as const, liveKitParticipantSid: null });
  store.groups.push(group("g1", "host"), group("g2", "other"), group("g3", "host"));
  store.memberships.push(
    { id: "m1", groupId: "g1", userId: "host", role: "host", joinedAt: AT, leftAt: null },
    { id: "m2", groupId: "g1", userId: "anna", role: "member", joinedAt: AT, leftAt: null },
    { id: "m3", groupId: "g2", userId: "other", role: "host", joinedAt: AT, leftAt: null },
    { id: "m4", groupId: "g2", userId: "anna", role: "member", joinedAt: AT, leftAt: null },
    { id: "m5", groupId: "g3", userId: "host", role: "host", joinedAt: AT, leftAt: null }
  );
  store.sessions.push(session("s1", "g1"), session("s2", "g1", "scheduled"), session("s3", "g2"));
  store.presences.push(presence("s1", "host"), presence("s1", "anna"), presence("s2", "anna"), presence("s3", "other"), presence("s3", "anna", true));
  store.intents.push({ id: "i1", sessionId: "s2", userId: "anna", plannedAt: AT, cancelledAt: null }, { id: "i2", sessionId: "s3", userId: "anna", plannedAt: AT, cancelledAt: null });
  store.meetings.push({ id: "mt1", sessionId: "s1", startedAt: AT, endedAt: null }, { id: "mt3", sessionId: "s3", startedAt: AT, endedAt: null });
  store.reminders.push({ id: "r1", sessionId: "s2", userId: "anna", sentAt: AT });
  store.tutorRequests.push({ id: "t1", sessionId: "s1", userId: "anna", clientEventId: "e1", text: "q", receivedAt: AT, inFlight: false, status: "queued" }, { id: "t3", sessionId: "s3", userId: "other", clientEventId: "e3", text: "q", receivedAt: AT, inFlight: false, status: "queued" });
  store.outbox.push({ id: "o1", kind: "room_message", dedupeKey: "t1", sessionId: "s1", payload: { room: "s1", projectId: "", text: "", messageId: "t1" }, status: "queued", attempts: 0, leaseOwner: null, leaseExpiresAt: null, nextAttemptAt: null, failureClass: null, createdAt: AT, deliveredAt: null });
  return store;
}

const ids = (rows: Array<{ id: string }>) => rows.map((row) => row.id).sort();

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "lg-sg-scope-"));
  repository = createStudyGroupRepository(directory);
});

afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("scopeStore: a session scope holds the session, its group, the group's memberships and every row of that session, nothing else", () => {
  const scoped = scopeStore(fixture(), { session: "s1" });
  assert.deepEqual(ids(scoped.sessions), ["s1"]);
  assert.deepEqual(ids(scoped.groups), ["g1"]);
  assert.deepEqual(ids(scoped.memberships), ["m1", "m2"]);
  assert.deepEqual(ids(scoped.presences), ["p-s1-anna", "p-s1-host"]);
  assert.deepEqual(ids(scoped.intents), []);
  assert.deepEqual(ids(scoped.meetings), ["mt1"]);
  assert.deepEqual(ids(scoped.reminders), []);
  assert.deepEqual(ids(scoped.tutorRequests), ["t1"]);
  assert.deepEqual(ids(scoped.outbox), ["o1"]);
  assert.deepEqual(scopeStore(fixture(), { session: "nope" }), emptyStore(), "an unknown session scopes to nothing");
});

test("scopeStore: a group scope holds the group even without sessions, its memberships, its sessions and their rows", () => {
  const scoped = scopeStore(fixture(), { group: "g1" });
  assert.deepEqual(ids(scoped.groups), ["g1"]);
  assert.deepEqual(ids(scoped.memberships), ["m1", "m2"]);
  assert.deepEqual(ids(scoped.sessions), ["s1", "s2"]);
  assert.deepEqual(ids(scoped.presences), ["p-s1-anna", "p-s1-host", "p-s2-anna"]);
  assert.deepEqual(ids(scoped.intents), ["i1"]);
  assert.deepEqual(ids(scoped.reminders), ["r1"]);
  assert.deepEqual(ids(scoped.tutorRequests), ["t1"]);
  const empty = scopeStore(fixture(), { group: "g3" });
  assert.deepEqual(ids(empty.groups), ["g3"]);
  assert.deepEqual(ids(empty.memberships), ["m5"]);
  assert.deepEqual(ids(empty.sessions), []);
});

test("scopeStore: seatsOf holds the sessions where the user holds an open seat, with everyone seated there; a left seat does not count", () => {
  const scoped = scopeStore(fixture(), { seatsOf: "anna" });
  assert.deepEqual(ids(scoped.sessions), ["s1", "s2"], "s3: anna's seat there is closed");
  assert.deepEqual(ids(scoped.groups), ["g1"]);
  assert.deepEqual(ids(scoped.presences), ["p-s1-anna", "p-s1-host", "p-s2-anna"], "the other seats of those sessions, so an emptied room can be told");
  assert.deepEqual(ids(scoped.meetings), ["mt1"]);
  assert.deepEqual(scopeStore(fixture(), { seatsOf: "nobody" }), emptyStore());
});

test("scopeStore shares row objects and mergeScopedRows appends only new rows, so a scoped change lands in the whole store", () => {
  const whole = fixture();
  const scoped = scopeStore(whole, { session: "s1" });
  scoped.presences[0].leftAt = AT;
  scoped.presences.push({ id: "p-new", sessionId: "s1", userId: "zed", requestedAt: `${AT}#2`, enteredAt: AT, lastSeenAt: AT, leftAt: null, phase: "live", liveKitParticipantSid: null });
  mergeScopedRows(whole, scoped);
  assert.equal(whole.presences.find((row) => row.id === scoped.presences[0].id)?.leftAt, AT);
  assert.equal(whole.presences.filter((row) => row.id === "p-new").length, 1);
  mergeScopedRows(whole, scoped);
  assert.equal(whole.presences.filter((row) => row.id === "p-new").length, 1, "idempotent");
  assert.equal(whole.presences.length, 6);
});

test("file adapter: a scoped read returns the scope, a scoped update changes and adds within it and leaves the rest untouched", async () => {
  await repository.update((store) => Object.assign(store, fixture()));
  const scoped = await repository.read({ session: "s3" });
  assert.deepEqual(ids(scoped.sessions), ["s3"]);
  assert.deepEqual(ids(scoped.groups), ["g2"]);
  const occupancy = await repository.update((store) => {
    assert.deepEqual(ids(store.sessions), ["s3"], "the mutate sees the scope only");
    store.presences.find((row) => row.userId === "other")!.leftAt = AT;
    store.presences.push({ id: "p-s3-new", sessionId: "s3", userId: "new", requestedAt: `${AT}#3`, enteredAt: AT, lastSeenAt: AT, leftAt: null, phase: "live", liveKitParticipantSid: null });
    store.sessions[0].title = "renamed";
    return store.presences.filter((row) => !row.leftAt).length;
  }, { session: "s3" });
  assert.equal(occupancy, 1);
  const whole = await repository.read();
  assert.equal(whole.sessions.length, 3);
  assert.equal(whole.sessions.find((row) => row.id === "s3")?.title, "renamed");
  assert.equal(whole.sessions.find((row) => row.id === "s1")?.title, "s1");
  assert.equal(whole.presences.find((row) => row.id === "p-s3-other")?.leftAt, AT);
  assert.ok(whole.presences.some((row) => row.id === "p-s3-new"));
  assert.equal(whole.presences.length, 6);
  assert.equal(whole.tutorRequests.length, 2, "rows outside the scope are kept");
  const onDisk = JSON.parse(await readFile(path.join(directory, "study-group.json"), "utf8")) as StudyGroupStore;
  assert.equal(onDisk.groups.length, 3);
});

test("pruneHistory removes only settled outbox rows and tutor requests older than the cutoff, oldest first and bounded; product history stays", async () => {
  const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
  const older = new Date(Date.now() - 50 * 86_400_000).toISOString();
  await repository.update((store) => {
    Object.assign(store, fixture());
    const outbox = (id: string, status: "queued" | "delivered" | "dead", createdAt: string) => ({ id, kind: "room_message" as const, dedupeKey: id, sessionId: "s1", payload: { room: "s1", projectId: "", text: "", messageId: id }, status, attempts: 0, leaseOwner: null, leaseExpiresAt: null, nextAttemptAt: null, failureClass: null, createdAt, deliveredAt: null });
    store.outbox.push(outbox("o-old-delivered", "delivered", old), outbox("o-older-dead", "dead", older), outbox("o-old-queued", "queued", older), outbox("o-new-delivered", "delivered", AT));
    const tutor = (id: string, status: "queued" | "answered" | "dead_letter", receivedAt: string) => ({ id, sessionId: "s1", userId: "anna", clientEventId: `e-${id}`, text: "q", receivedAt, inFlight: false, status });
    store.tutorRequests.push(tutor("t-old-answered", "answered", old), tutor("t-older-dead", "dead_letter", older), tutor("t-old-queued", "queued", older), tutor("t-new-answered", "answered", AT));
  });
  assert.deepEqual(await repository.pruneHistory({ olderThanDays: 30, limit: 1 }), { outbox: 1, tutorRequests: 1, webhookReceipts: 0 });
  let store = await repository.read();
  assert.ok(!store.outbox.some((row) => row.id === "o-older-dead"), "oldest first");
  assert.ok(store.outbox.some((row) => row.id === "o-old-delivered"));
  assert.ok(!store.tutorRequests.some((row) => row.id === "t-older-dead"));
  assert.deepEqual(await repository.pruneHistory({ olderThanDays: 30, limit: 100 }), { outbox: 1, tutorRequests: 1, webhookReceipts: 0 });
  store = await repository.read();
  assert.deepEqual(ids(store.outbox), ["o-new-delivered", "o-old-queued", "o1"], "queued rows and recent rows stay whatever their age");
  assert.deepEqual(ids(store.tutorRequests), ["t-new-answered", "t-old-queued", "t1", "t3"]);
  assert.equal(store.presences.length, 5);
  assert.equal(store.sessions.length, 3);
  assert.deepEqual(await repository.pruneHistory({ olderThanDays: 30, limit: 100 }), { outbox: 0, tutorRequests: 0, webhookReceipts: 0 }, "idempotent");
});

test("a scoped file update persists a row the mutation replaced by a new object under a known id (PostgreSQL's by-id diff does), not only rows changed in place or added", async () => {
  // Persistence review 2026-11-03: the scoped view shares row objects with the
  // whole store, so an in-place change is already in `whole`; a mutation that
  // swaps in a new object (`store.sessions[0] = { ...store.sessions[0], ... }`)
  // used to be dropped silently by the file adapter while PostgreSQL persisted
  // it, so the unit suite could not prove what production would store.
  await repository.update((store) => { Object.assign(store, fixture()); });
  await repository.update((store) => {
    store.sessions[0] = { ...store.sessions[0], title: "renamed" };
    store.presences[0] = { ...store.presences[0], leftAt: AT };
  }, { session: "s1" });
  const whole = await repository.read();
  assert.equal(whole.sessions.find((row) => row.id === "s1")?.title, "renamed");
  assert.equal(whole.presences.find((row) => row.id === "p-s1-host")?.leftAt, AT);
  assert.equal(whole.sessions.length, 3, "nothing duplicated");
  assert.equal(whole.presences.length, 5);
});
