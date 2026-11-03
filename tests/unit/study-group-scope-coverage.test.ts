// Review B of the 2026-11-03 backend fixes (H2 scoped reads, H3 per-session
// entry queues). Every service rule is run through the file adapter, which
// filters a scoped read exactly like the PostgreSQL adapter, against a store
// with a SECOND group, a SECOND session and seats, plans and questions held
// ELSEWHERE. A scope too narrow for a rule would make that rule evaluate an
// empty set and silently pass (a full room admitting, a live room ending,
// a limit never reached); each test here would then go red.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { createStudyGroupService, type StudyGroupDeps, type StudyGroupService } from "../../modules/group-study/service";
import { createStudyGroupRepository, type StudyGroupRepository, type StudyGroupScope } from "../../modules/group-study/repository";
import { tutorRequestState } from "../../modules/group-study/domain";

// 02:00; a session at 02:05 is Starting Soon (seats open), one at 02:20 is still scheduled (no seats yet).
const NOW = "2026-09-19T02:00:00.000Z";
const SOON = "2026-09-19T02:05:00.000Z";
const SOON_2 = "2026-09-19T02:06:00.000Z";
const LATER = "2026-09-19T02:20:00.000Z";
const COURSE = "course-1";
const USERS = ["host", "host2", "anna", "ben", "cleo", "dan", "zed"] as const;

let directory: string;
let repository: StudyGroupRepository;
let service: StudyGroupService;
let scopes: Array<{ op: "read" | "update"; scope: StudyGroupScope | undefined }> = [];
const notes: Array<{ userId: string; title: string; body: string; sessionId?: string }> = [];
const ksCalls: Array<{ message: string; history: Array<{ role: string; content: string }> }> = [];
let access: Set<string>;

function deps(extra: Partial<StudyGroupDeps> = {}): StudyGroupDeps {
  return {
    repository: {
      ...repository,
      read: (scope) => { scopes.push({ op: "read", scope }); return repository.read(scope); },
      update: (mutate, scope) => { scopes.push({ op: "update", scope }); return repository.update(mutate, scope); }
    },
    now: () => new Date(NOW),
    hasCourseAccess: async (userId, courseId) => access.has(`${userId}:${courseId}`),
    courseSummary: async (courseId) => courseId === COURSE ? { id: courseId, title: "German History", slug: "german-history" } : null,
    accessibleCourses: async () => [{ id: COURSE, title: "German History", slug: "german-history" }],
    userProfile: async (userId) => ({ id: userId, displayName: userId, email: `${userId}@example.test`, locale: "en-GB" }),
    notify: async (input) => { notes.push(input); },
    listReminders: async () => [],
    sendMail: async () => undefined,
    liveKit: { apiKey: "lk-key", apiSecret: "lk-secret-at-least-32-characters", url: "wss://livekit.example.test" },
    tokenLogKey: () => Buffer.alloc(32, 7),
    tutorKs: async ({ message, history }) => { ksCalls.push({ message, history }); return `Answer: ${message}`; },
    ...extra
  };
}

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "lg-sg-scope-coverage-"));
  repository = createStudyGroupRepository(directory);
  scopes = [];
  notes.length = 0;
  ksCalls.length = 0;
  access = new Set(USERS.map((user) => `${user}:${COURSE}`));
  service = createStudyGroupService(deps());
});

afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

const code = (expected: string) => (error: unknown) => (error as { code?: string }).code === expected;

/** Two groups: G1 hosted by host with anna, ben, cleo, dan; G2 hosted by host2 with anna. */
async function twoGroups() {
  const g1 = await service.createGroup({ actorUserId: "host", title: "Group one", courseId: COURSE, about: "First group." });
  const g2 = await service.createGroup({ actorUserId: "host2", title: "Group two", courseId: COURSE, about: "Second group." });
  for (const user of ["anna", "ben", "cleo", "dan"]) await service.joinGroup({ actorUserId: user, groupId: g1.id });
  await service.joinGroup({ actorUserId: "anna", groupId: g2.id });
  return { g1, g2 };
}

function schedule(host: string, groupId: string, title: string, startsAt: string, maxParticipants = 4) {
  return service.scheduleSession({ actorUserId: host, groupId, title, startsAt, durationSeconds: 1800, maxParticipants });
}

const enter = (user: string, sessionId: string) => service.enterSession({ actorUserId: user, sessionId, requestedAt: NOW }) as Promise<{ occupancy: number }>;
const occupancy = async (sessionId: string) => (await repository.read({ session: sessionId })).presences.filter((row) => row.sessionId === sessionId && row.enteredAt && !row.leftAt).length;
const sessionRow = async (sessionId: string) => (await repository.read({ session: sessionId })).sessions[0];

// ---------------------------------------------------------------- H2: rules that must see other people's rows of the same session

test("H2 seat(): capacity and the Host's reserved seat are counted from every seat of THIS session; seats in the sibling session and in another group never count", async () => {
  const { g1, g2 } = await twoGroups();
  const a = await schedule("host", g1.id, "A", SOON, 3);
  const b = await schedule("host", g1.id, "B", SOON_2, 3);
  const c = await schedule("host2", g2.id, "C", SOON, 3);
  // anna holds a seat in another group's room first: it must not count against A, nor let her skip A's rules.
  assert.equal((await enter("anna", c.id)).occupancy, 1);
  assert.equal((await enter("ben", a.id)).occupancy, 1);
  assert.equal((await enter("cleo", a.id)).occupancy, 2);
  // Starting Soon, max 3: members may fill two seats, the third stays the Host's (QA N7).
  await assert.rejects(() => enter("dan", a.id), code("session_full"), "the Host's reservation is computed from the group row and A's seats");
  await assert.rejects(() => enter("anna", a.id), code("session_full"), "a seat held in another group buys nothing here");
  assert.equal((await enter("dan", b.id)).occupancy, 1, "the sibling session has its own seats");
  assert.equal((await enter("host", a.id)).occupancy, 3, "the Host takes the reserved seat");
  await assert.rejects(() => enter("dan", a.id), code("session_full"), "full: three held seats are seen");
  assert.equal((await enter("ben", a.id)).occupancy, 3, "re-entering while seated renews the same seat");
  assert.equal(await occupancy(a.id), 3);
  assert.equal(await occupancy(b.id), 1);
  assert.equal(await occupancy(c.id), 1);
});

test("H2 startSession: the Host's start consults this session's seats and meeting rows, with a live sibling and a live room in another group present", async () => {
  const { g1, g2 } = await twoGroups();
  const a = await schedule("host", g1.id, "A", SOON, 2);
  const b = await schedule("host", g1.id, "B", SOON_2, 2);
  const c = await schedule("host2", g2.id, "C", SOON, 2);
  await service.startSession({ actorUserId: "host2", sessionId: c.id });
  await service.startSession({ actorUserId: "host", sessionId: b.id });
  assert.equal((await enter("ben", a.id)).occupancy, 1, "one of two seats: the other is the Host's");
  await assert.rejects(() => enter("cleo", a.id), code("session_full"));
  const started = await service.startSession({ actorUserId: "host", sessionId: a.id });
  assert.equal(started.state, "live");
  assert.equal(started.occupancy, 2, "starting seats the Host (F-1) next to the waiting member");
  await service.startSession({ actorUserId: "host", sessionId: a.id });
  const store = await repository.read();
  assert.equal(store.meetings.filter((row) => row.sessionId === a.id).length, 1, "a repeated start sees the existing meeting row");
  assert.equal(store.meetings.length, 3);
  assert.deepEqual(store.sessions.map((row) => row.status).sort(), ["live", "live", "live"]);
});

test("H2 enqueueTutor: the per-asker limits and the client-event replay are judged from this session's questions; questions waiting in another room do not count", async () => {
  const { g1, g2 } = await twoGroups();
  const a = await schedule("host", g1.id, "A", SOON);
  const c = await schedule("host2", g2.id, "C", SOON);
  await service.startSession({ actorUserId: "host", sessionId: a.id });
  await service.startSession({ actorUserId: "host2", sessionId: c.id });
  await enter("anna", a.id);
  await enter("anna", c.id);
  const first = await service.enqueueTutor({ actorUserId: "anna", sessionId: a.id, text: "one", clientEventId: "e1" });
  const second = await service.enqueueTutor({ actorUserId: "anna", sessionId: a.id, text: "two", clientEventId: "e2" });
  assert.equal(first.position, 0);
  assert.equal(second.position, 1, "the first waiting question is seen ahead of the second");
  await assert.rejects(() => service.enqueueTutor({ actorUserId: "anna", sessionId: a.id, text: "three", clientEventId: "e3" }), code("tutor_busy"), "two waiting in this room");
  const elsewhere = await service.enqueueTutor({ actorUserId: "anna", sessionId: c.id, text: "other room", clientEventId: "e1" });
  assert.equal(elsewhere.position, 0, "the other room has its own queue, and its own client event ids");
  const replay = await service.enqueueTutor({ actorUserId: "anna", sessionId: a.id, text: "one", clientEventId: "e1" });
  assert.equal(replay.id, first.id, "a replay finds the earlier row of this session");
  assert.equal((await repository.read()).tutorRequests.length, 3);
  // The Host's view of the room: anna's two waiting questions, in order.
  const view = await service.getSession({ actorUserId: "anna", sessionId: a.id });
  assert.deepEqual(view.viewerTutorQuestions?.map((item) => item.position), [0, 1]);
});

test("H2 drainTutorSession: the Tutor's memory is this room's earlier exchanges (tutor requests joined to outbox rows), never another room's", async () => {
  const { g1, g2 } = await twoGroups();
  const a = await schedule("host", g1.id, "A", SOON);
  const c = await schedule("host2", g2.id, "C", SOON);
  await service.startSession({ actorUserId: "host", sessionId: a.id });
  await service.startSession({ actorUserId: "host2", sessionId: c.id });
  await enter("anna", a.id);
  await enter("anna", c.id);
  await service.enqueueTutor({ actorUserId: "anna", sessionId: c.id, text: "about C", clientEventId: "c1" });
  await service.deliverTutorAnswer({ sessionId: c.id });
  await service.enqueueTutor({ actorUserId: "anna", sessionId: a.id, text: "first in A", clientEventId: "a1" });
  await service.deliverTutorAnswer({ sessionId: a.id });
  await service.enqueueTutor({ actorUserId: "anna", sessionId: a.id, text: "second in A", clientEventId: "a2" });
  await service.deliverTutorAnswer({ sessionId: a.id });
  assert.equal(ksCalls.length, 3);
  assert.deepEqual(ksCalls[2].history, [{ role: "user", content: "first in A" }, { role: "assistant", content: "Answer: first in A" }], "A's history: its own exchange, not C's");
  assert.deepEqual(ksCalls[1].history, []);
});

test("H2 leaveGroup: the member's seats, plans and waiting questions go in EVERY session of that group, and nothing of theirs in another group is touched", async () => {
  const { g1, g2 } = await twoGroups();
  const a = await schedule("host", g1.id, "A", SOON);
  const b = await schedule("host", g1.id, "B", LATER);
  const c = await schedule("host2", g2.id, "C", SOON);
  const e = await schedule("host2", g2.id, "E", LATER);
  await service.startSession({ actorUserId: "host", sessionId: a.id });
  await service.startSession({ actorUserId: "host2", sessionId: c.id });
  await enter("anna", a.id);
  await enter("anna", c.id);
  await service.enqueueTutor({ actorUserId: "anna", sessionId: a.id, text: "in A", clientEventId: "a1" });
  await service.enqueueTutor({ actorUserId: "anna", sessionId: c.id, text: "in C", clientEventId: "c1" });
  await service.planToAttend({ actorUserId: "anna", sessionId: b.id });
  await service.planToAttend({ actorUserId: "anna", sessionId: e.id });
  await service.planToAttend({ actorUserId: "ben", sessionId: b.id });
  await service.leaveGroup({ actorUserId: "anna", groupId: g1.id });
  const store = await repository.read();
  const intent = (sessionId: string, userId: string) => store.intents.find((row) => row.sessionId === sessionId && row.userId === userId);
  const request = (sessionId: string) => store.tutorRequests.find((row) => row.sessionId === sessionId && row.userId === "anna")!;
  assert.equal(await occupancy(a.id), 1, "anna's seat in A is released (the Host stays, A stays live)");
  assert.equal((await sessionRow(a.id)).status, "live");
  assert.ok(intent(b.id, "anna")?.cancelledAt, "her plan for the group's later session is withdrawn");
  assert.equal(intent(b.id, "ben")?.cancelledAt, null, "ben's plan stays");
  assert.equal(tutorRequestState(request(a.id)), "dead_letter");
  assert.equal(request(a.id).terminalReason, "member_left");
  assert.equal(await occupancy(c.id), 2, "her seat in the other group's room stays");
  assert.equal(intent(e.id, "anna")?.cancelledAt, null, "her plan in the other group stays");
  assert.equal(tutorRequestState(request(c.id)), "queued", "her question in the other group's room stays");
});

test("H2 cancelGroup: every scheduled session of the group is removed, every live one ends and every seat in them is released; the other group's rooms go on", async () => {
  const { g1, g2 } = await twoGroups();
  const a = await schedule("host", g1.id, "A", SOON);
  const b = await schedule("host", g1.id, "B", LATER);
  const c = await schedule("host2", g2.id, "C", SOON);
  await service.startSession({ actorUserId: "host", sessionId: a.id });
  await service.startSession({ actorUserId: "host2", sessionId: c.id });
  await enter("ben", a.id);
  await enter("anna", c.id);
  await service.cancelGroup({ actorUserId: "host", groupId: g1.id });
  const store = await repository.read();
  assert.equal(store.sessions.find((row) => row.id === a.id)?.status, "completed");
  assert.equal(store.sessions.find((row) => row.id === b.id)?.status, "removed");
  assert.equal(await occupancy(a.id), 0, "the Host's and ben's seats in A are released");
  assert.equal(store.meetings.find((row) => row.sessionId === a.id)?.endedAt, NOW);
  assert.equal(store.sessions.find((row) => row.id === c.id)?.status, "live");
  assert.equal(await occupancy(c.id), 2);
  assert.deepEqual(notes.filter((note) => note.title === "Study Group cancelled").map((note) => note.userId).sort(), ["anna", "ben", "cleo", "dan"], "every member but the Host, once");
});

test("H2 evictUser (seatsOf): seats in rooms of different groups all go; a room with someone left stays live, a room the user alone held ends; other people's seats stay", async () => {
  const { g1, g2 } = await twoGroups();
  const a = await schedule("host", g1.id, "A", SOON);
  const b = await schedule("host", g1.id, "B", SOON_2);
  const c = await schedule("host2", g2.id, "C", SOON);
  await service.startSession({ actorUserId: "host", sessionId: a.id });
  await service.startSession({ actorUserId: "host2", sessionId: c.id });
  await enter("anna", a.id);
  await enter("anna", b.id);
  await enter("anna", c.id);
  await enter("ben", b.id);
  await service.leaveSession({ actorUserId: "host2", sessionId: c.id });
  assert.equal((await sessionRow(c.id)).status, "live", "anna still holds a seat in C");
  assert.deepEqual(await service.evictUser({ userId: "anna" }), { sessions: 2 }, "two live rooms to leave (A and C); the waiting seat in B is released without a provider call");
  assert.equal(await occupancy(a.id), 1, "the Host stays seated in A");
  assert.equal((await sessionRow(a.id)).status, "live");
  assert.equal(await occupancy(b.id), 1, "ben's waiting seat stays");
  assert.equal(await occupancy(c.id), 0);
  assert.equal((await sessionRow(c.id)).status, "completed", "nobody left in C: it ends, judged from every seat of C");
  assert.deepEqual(await service.evictUser({ userId: "anna" }), { sessions: 0 });
});

test("H2 session views and the entry decision count plans and seats of that session only", async () => {
  const { g1 } = await twoGroups();
  const a = await schedule("host", g1.id, "A", SOON, 3);
  const b = await schedule("host", g1.id, "B", SOON_2, 3);
  await service.planToAttend({ actorUserId: "anna", sessionId: a.id });
  await service.planToAttend({ actorUserId: "ben", sessionId: a.id });
  await service.planToAttend({ actorUserId: "ben", sessionId: b.id });
  await enter("ben", a.id);
  const viewA = await service.getSession({ actorUserId: "anna", sessionId: a.id });
  const viewB = await service.getSession({ actorUserId: "anna", sessionId: b.id });
  assert.equal(viewA.plannedCount, 2);
  assert.equal(viewB.plannedCount, 1);
  assert.equal(viewA.viewerPlanned, true);
  assert.equal(viewB.viewerPlanned, false);
  assert.equal(viewA.occupancy, 1);
  assert.equal(viewA.seatsOpen, 1, "3 seats, one held, one reserved for the Host");
  assert.equal(viewB.seatsOpen, 2);
  assert.deepEqual(viewA.attendees.map((item) => item.userId).sort(), ["anna", "ben"], "planned attendees before the start");
  const entryA = await service.sessionEntry({ actorUserId: "anna", sessionId: a.id });
  const entryB = await service.sessionEntry({ actorUserId: "anna", sessionId: b.id });
  assert.equal(entryA.viewer?.planned, true);
  assert.equal(entryB.viewer?.planned, false);
  assert.equal(entryA.session?.occupancy, 1);
  assert.equal(entryA.next, "wait");
  await enter("cleo", a.id);
  assert.equal((await service.sessionEntry({ actorUserId: "anna", sessionId: a.id })).next, "full", "two member seats held, the third is the Host's");
  assert.equal((await service.sessionEntry({ actorUserId: "host", sessionId: a.id })).next, "host_start");
});

test("H2 editSession (reschedule) and cancelSession: reminders and notices concern this session's planners only", async () => {
  const { g1 } = await twoGroups();
  const a = await schedule("host", g1.id, "A", SOON);
  const b = await schedule("host", g1.id, "B", SOON_2);
  await service.planToAttend({ actorUserId: "ben", sessionId: a.id });
  await service.planToAttend({ actorUserId: "cleo", sessionId: b.id });
  await service.dispatchDueReminders();
  const reminders = (user: string) => notes.filter((note) => note.title === "Live Session reminder" && note.userId === user);
  assert.equal(reminders("ben").length, 1);
  assert.equal(reminders("cleo").length, 1);
  assert.equal(reminders("host").length, 2, "the Host is reminded of both");
  await service.editSession({ actorUserId: "host", groupId: g1.id, sessionId: a.id, startsAt: "2026-09-19T02:08:00.000Z" });
  assert.deepEqual(notes.filter((note) => note.title === "Live Session rescheduled").map((note) => note.userId), ["ben"], "only A's planner is told");
  assert.equal(reminders("ben").length, 2, "A's reminder rows were re-armed in the move's own write");
  assert.equal(reminders("cleo").length, 1, "B's reminder rows were not");
  assert.equal(reminders("host").length, 3);
  await service.cancelSession({ actorUserId: "host", sessionId: a.id });
  assert.deepEqual(notes.filter((note) => note.title === "Live Session cancelled").map((note) => note.userId), ["ben"]);
  const store = await repository.read();
  assert.equal(store.sessions.find((row) => row.id === b.id)?.status, "scheduled");
});

test("H2 planToAttend: planning again after a cancel restores the in-site reminder from this session's reminder row", async () => {
  const { g1 } = await twoGroups();
  const a = await schedule("host", g1.id, "A", SOON);
  await schedule("host", g1.id, "B", SOON_2);
  await service.planToAttend({ actorUserId: "ben", sessionId: a.id });
  await service.dispatchDueReminders();
  await service.cancelAttendance({ actorUserId: "ben", sessionId: a.id });
  await service.planToAttend({ actorUserId: "ben", sessionId: a.id });
  assert.equal(notes.filter((note) => note.title === "Live Session reminder" && note.userId === "ben").length, 2, "the card comes back without a second mail");
  await service.planToAttend({ actorUserId: "ben", sessionId: a.id });
  assert.equal(notes.filter((note) => note.title === "Live Session reminder" && note.userId === "ben").length, 2, "already planned: nothing more");
});

test("H2 group views: a group is Live only through its own sessions; the views of create, join, edit and get read the group's sessions", async () => {
  const { g1, g2 } = await twoGroups();
  const c = await schedule("host2", g2.id, "C", SOON);
  await service.startSession({ actorUserId: "host2", sessionId: c.id });
  assert.equal((await service.getGroup({ actorUserId: "anna", groupId: g1.id })).live, false, "another group's live room does not light this one up");
  assert.equal((await service.getGroup({ actorUserId: "anna", groupId: g2.id })).live, true);
  const a = await schedule("host", g1.id, "A", SOON);
  await service.startSession({ actorUserId: "host", sessionId: a.id });
  assert.equal((await service.getGroup({ actorUserId: "anna", groupId: g1.id })).live, true);
  assert.equal((await service.joinGroup({ actorUserId: "zed", groupId: g1.id })).live, true);
  assert.equal((await service.editGroup({ actorUserId: "host", groupId: g1.id, title: "Renamed", about: "Still the first group." })).live, true);
  assert.equal((await service.editGroup({ actorUserId: "host2", groupId: g2.id, title: "Renamed two", about: "Still the second." })).memberCount, 2);
  const detail = await service.getGroup({ actorUserId: "host", groupId: g1.id });
  assert.deepEqual(detail.sessions?.map((item) => item.id), [a.id]);
  assert.equal(detail.memberCount, 6);
});

test("H2 scheduleSession: the duplicate-submit check sees the group's sibling sessions (group scope), not another group's", async () => {
  const { g1, g2 } = await twoGroups();
  const a = await schedule("host", g1.id, "Same", SOON);
  const again = await schedule("host", g1.id, "Same", SOON);
  assert.equal(again.id, a.id, "a repeated submit inside the window returns the first row");
  const other = await schedule("host2", g2.id, "Same", SOON);
  assert.notEqual(other.id, a.id, "the same fields in another group are a new session");
  assert.equal((await repository.read()).sessions.length, 2);
});

// ---------------------------------------------------------------- the scope each method names (pins H2 against a later narrowing)

test("H2 scope table: every per-session method reads and writes { session }, every group method { group }, evictUser { seatsOf }, and the sweeps read the whole store", async () => {
  const { g1 } = await twoGroups();
  const a = await schedule("host", g1.id, "A", SOON);
  const b = await schedule("host", g1.id, "B", LATER);
  const seen = (run: () => Promise<unknown>) => async () => { scopes = []; await run().catch(() => undefined); return scopes.map((item) => `${item.op}:${item.scope ? Object.keys(item.scope)[0] : "whole"}`); };
  const only = (kinds: string[], expected: string[], why?: string) => assert.deepEqual([...new Set(kinds)].sort(), expected.sort(), why);
  only(await seen(() => service.getSession({ actorUserId: "host", sessionId: a.id }))(), ["read:session"]);
  only(await seen(() => service.sessionEntry({ actorUserId: "anna", sessionId: a.id }))(), ["read:session"]);
  only(await seen(() => service.planToAttend({ actorUserId: "ben", sessionId: b.id }))(), ["update:session"]);
  only(await seen(() => service.cancelAttendance({ actorUserId: "ben", sessionId: b.id }))(), ["update:session"]);
  only(await seen(() => enter("anna", a.id))(), ["read:session", "update:session"]);
  only(await seen(() => service.heartbeat({ actorUserId: "anna", sessionId: a.id }))(), [], "a held seat is renewed by renewSeat alone: no store read, no scoped update");
  only(await seen(() => service.reportLiveKitIncident({ actorUserId: "anna", sessionId: a.id, code: "network_lost" }))(), ["read:session"]);
  only(await seen(() => service.startSession({ actorUserId: "host", sessionId: a.id }))(), ["read:session", "update:session"]);
  only(await seen(() => service.issueToken({ actorUserId: "anna", sessionId: a.id }))(), ["read:session"]);
  only(await seen(() => service.enqueueTutor({ actorUserId: "anna", sessionId: a.id, text: "q", clientEventId: "e1" }))(), ["read:session", "update:session"]);
  only(await seen(() => service.withdrawTutor({ actorUserId: "anna", sessionId: a.id, requestId: "nope" }))(), ["read:session"]);
  only(await seen(() => service.deliverTutorAnswer({ sessionId: a.id }))(), ["read:session"], "the claim/settle/outbox steps are the adapter's own single-row operations");
  only(await seen(() => service.editSession({ actorUserId: "host", groupId: g1.id, sessionId: b.id, aiTutorEnabled: false }))(), ["read:session", "update:session"]);
  only(await seen(() => service.leaveSession({ actorUserId: "anna", sessionId: a.id }))(), ["update:session"]);
  only(await seen(() => service.cancelSession({ actorUserId: "host", sessionId: b.id }))(), ["update:session"]);
  only(await seen(() => service.getGroup({ actorUserId: "anna", groupId: g1.id }))(), ["read:group"]);
  only(await seen(() => service.joinGroup({ actorUserId: "zed", groupId: g1.id }))(), ["read:group", "update:group"]);
  only(await seen(() => service.editGroup({ actorUserId: "host", groupId: g1.id, title: "T", about: "About." }))(), ["read:group", "update:group"]);
  only(await seen(() => schedule("host", g1.id, "D", LATER))(), ["read:session", "update:group"]);
  only(await seen(() => service.leaveGroup({ actorUserId: "zed", groupId: g1.id }))(), ["read:group", "update:group"]);
  only(await seen(() => service.evictUser({ userId: "anna" }))(), ["update:seatsOf"]);
  only(await seen(() => service.createGroup({ actorUserId: "host", title: "New", courseId: COURSE, about: "Another." }))(), ["read:group", "update:whole"], "the duplicate-submit check spans all the Host's groups");
  only(await seen(() => service.cancelGroup({ actorUserId: "host", groupId: g1.id }))(), ["update:group"]);
  only(await seen(() => service.listMine("anna"))(), ["read:whole"]);
  only(await seen(() => service.listDiscover({ actorUserId: "zed" }))(), ["read:whole"]);
  only(await seen(() => service.learnerSchedule("anna"))(), ["read:whole"]);
  only(await seen(() => service.sweepPresence())(), ["read:whole"]);
  only(await seen(() => service.dispatchDueReminders())(), ["read:whole"]);
});

// ---------------------------------------------------------------- H3: the precheck outside the queue, the write inside it

test("H3 TOCTOU: what changes between the precheck and the queued admission is judged again inside the write, so a cancelled session, a dropped membership or a cancelled group seats nobody", async () => {
  const { g1 } = await twoGroups();
  const a = await schedule("host", g1.id, "A", SOON);
  const b = await schedule("host", g1.id, "B", SOON_2);
  const g3 = await service.createGroup({ actorUserId: "host", title: "Group three", courseId: COURSE, about: "Third group." });
  const d = await schedule("host", g3.id, "D", SOON);
  await service.joinGroup({ actorUserId: "anna", groupId: g3.id });
  // The course-access check is the last step of the precheck: a change landing there lands between the precheck and the queue.
  let during: (() => Promise<unknown>) | null = null;
  const racing = createStudyGroupService(deps({ hasCourseAccess: async () => { const run = during; during = null; if (run) await run(); return true; } }));
  during = () => service.cancelSession({ actorUserId: "host", sessionId: a.id });
  await assert.rejects(() => racing.enterSession({ actorUserId: "anna", sessionId: a.id, requestedAt: NOW }), code("not_found"));
  during = () => service.leaveGroup({ actorUserId: "anna", groupId: g1.id });
  await assert.rejects(() => racing.enterSession({ actorUserId: "anna", sessionId: b.id, requestedAt: NOW }), code("forbidden"));
  during = () => service.cancelGroup({ actorUserId: "host", groupId: g3.id });
  await assert.rejects(() => racing.enterSession({ actorUserId: "anna", sessionId: d.id, requestedAt: NOW }), code("not_found"));
  const store = await repository.read();
  assert.equal(store.presences.filter((row) => row.userId === "anna").length, 0, "no seat was written by any of the three");
});

test("H3 per-session queues: an admission stalled in one room does not hold up an admission to another room, and entries to one room stay in receipt order", async () => {
  const { g1 } = await twoGroups();
  const a = await schedule("host", g1.id, "A", SOON);
  const b = await schedule("host", g1.id, "B", SOON_2);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let stall = true;
  const order: string[] = [];
  const gated = createStudyGroupService(deps({
    repository: {
      ...repository,
      update: async (mutate, scope) => {
        // Parked BEFORE the store's own write queue, so only this room's admission waits.
        if (stall && scope && "session" in scope && scope.session === a.id) { stall = false; await gate; }
        return repository.update(mutate, scope);
      }
    }
  }));
  const intoA = gated.enterSession({ actorUserId: "anna", sessionId: a.id, requestedAt: `${NOW}#1` }).then(() => order.push("anna:A"));
  const annaB = gated.enterSession({ actorUserId: "anna", sessionId: b.id, requestedAt: `${NOW}#2` }).then(() => order.push("anna:B"));
  const benA = gated.enterSession({ actorUserId: "ben", sessionId: a.id, requestedAt: `${NOW}#3` }).then(() => order.push("ben:A"));
  await annaB;
  assert.deepEqual(order, ["anna:B"], "room B admitted while room A's first admission is still parked");
  release();
  await Promise.all([intoA, benA]);
  assert.deepEqual(order, ["anna:B", "anna:A", "ben:A"], "room A's entries resolve in receipt order behind the parked one");
  assert.equal(await occupancy(a.id), 2);
  assert.equal(await occupancy(b.id), 1);
});
